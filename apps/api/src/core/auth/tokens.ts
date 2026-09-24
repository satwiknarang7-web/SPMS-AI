import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config, isProd } from '../../config';
import { audit, systemActor } from '../audit';
import { prisma, tx, type Db } from '../db';
import { AppError } from '../errors';

/**
 * Session tokens.
 *
 *  • Access token — a JWT valid for ACCESS_TOKEN_TTL_SECONDS (15 min by default). Carried in an
 *    httpOnly cookie (browsers) or an `Authorization: Bearer` header (store agents, scripts).
 *    Claims: sub (user), tid (tenant), sid (store), ses (session id).
 *  • Refresh token — 256 bits of randomness, stored only as a SHA-256 hash, single-use.
 *    Sent in an httpOnly cookie scoped to /api/auth so it never travels with normal API calls.
 *    Every refresh rotates it. Re-presenting a used token means it was copied, so the whole
 *    session is revoked (refresh-token reuse detection).
 *  • Session — the signed-in device. Access tokens name their session and the API checks it on
 *    every request, so sign-out, password reset and deactivation take effect immediately.
 */

export const ACCESS_COOKIE = 'segue_at';
export const REFRESH_COOKIE = 'segue_rt';
/**
 * Non-secret hint that a session exists (value "1", lifetime of the refresh token). Lets the
 * web app's route guard tell "signed out" from "access token merely expired" on page loads,
 * since the refresh cookie itself is only sent to /api/auth. It grants nothing.
 */
export const SESSION_HINT_COOKIE = 'segue_signed_in';
const REFRESH_PATH = '/api/auth';

export interface AccessClaims {
  sub: string;
  tid: string | null;
  sid: string | null;
  ses: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessClaims;
    user: AccessClaims;
  }
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const newRefreshToken = () => randomBytes(32).toString('base64url');

export interface IssuedTokens {
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  sessionId: string;
}

function setCookies(reply: FastifyReply, accessToken: string, refreshToken: string, refreshExpires: Date) {
  reply.setCookie(ACCESS_COOKIE, accessToken, { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/', maxAge: config.ACCESS_TOKEN_TTL_SECONDS });
  reply.setCookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    path: REFRESH_PATH,
    maxAge: Math.max(1, Math.floor((refreshExpires.getTime() - Date.now()) / 1000)),
  });
  reply.setCookie(SESSION_HINT_COOKIE, '1', { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/', maxAge: Math.max(1, Math.floor((refreshExpires.getTime() - Date.now()) / 1000)) });
}

export function clearAuthCookies(reply: FastifyReply) {
  reply.clearCookie(ACCESS_COOKIE, { path: '/' });
  reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
  reply.clearCookie(SESSION_HINT_COOKIE, { path: '/' });
}

async function signAccess(reply: FastifyReply, claims: AccessClaims) {
  return reply.jwtSign(claims, { expiresIn: config.ACCESS_TOKEN_TTL_SECONDS });
}

function refreshExpiry(sessionExpiresAt: Date) {
  const sliding = new Date(Date.now() + config.REFRESH_TOKEN_TTL_HOURS * 3_600_000);
  return sliding < sessionExpiresAt ? sliding : sessionExpiresAt;
}

/** Start a new session for a user who has just authenticated. */
export async function startSession(req: FastifyRequest, reply: FastifyReply, user: { id: string; tenantId: string | null }, storeId: string | null): Promise<IssuedTokens> {
  const refreshToken = newRefreshToken();
  const sessionExpiresAt = new Date(Date.now() + config.SESSION_MAX_DAYS * 86_400_000);
  const refreshExpires = refreshExpiry(sessionExpiresAt);
  const session = await tx(async (db) => {
    const s = await db.session.create({
      data: { userId: user.id, storeId, userAgent: req.headers['user-agent']?.slice(0, 250) ?? null, ip: req.ip, expiresAt: sessionExpiresAt },
    });
    await db.refreshToken.create({ data: { sessionId: s.id, tokenHash: hash(refreshToken), expiresAt: refreshExpires } });
    return s;
  });
  const accessToken = await signAccess(reply, { sub: user.id, tid: user.tenantId, sid: storeId, ses: session.id });
  setCookies(reply, accessToken, refreshToken, refreshExpires);
  return { accessTokenExpiresAt: new Date(Date.now() + config.ACCESS_TOKEN_TTL_SECONDS * 1000), refreshTokenExpiresAt: refreshExpires, sessionId: session.id };
}

/** Exchange a refresh token for a new access + refresh token pair (rotation). */
export async function rotateSession(req: FastifyRequest, reply: FastifyReply): Promise<IssuedTokens & { claims: AccessClaims }> {
  const presented = req.cookies[REFRESH_COOKIE] ?? (req.body as { refreshToken?: string } | undefined)?.refreshToken;
  if (!presented) throw new AppError(401, 'NO_REFRESH_TOKEN', 'Please sign in again');

  const record = await prisma.refreshToken.findUnique({ where: { tokenHash: hash(presented) }, include: { session: { include: { user: true } } } });
  if (!record) {
    clearAuthCookies(reply);
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Please sign in again');
  }
  const { session } = record;

  if (record.usedAt) {
    // A rotated-out token came back: someone else holds a copy. Kill the whole session.
    await revokeSession(session.id, 'REFRESH_TOKEN_REUSE');
    await tx((db) => audit(db, { ...systemActor(session.user.tenantId), userId: session.userId, userName: session.user.name }, {
      module: 'PLATFORM', action: 'auth.refresh_reuse', entityType: 'Session', entityId: session.id,
      summary: `Refresh token reuse detected for ${session.user.email} — session revoked`,
    }));
    clearAuthCookies(reply);
    throw new AppError(401, 'SESSION_REVOKED', 'Your session was ended for security reasons. Please sign in again.');
  }
  if (session.revokedAt || !session.user.isActive) {
    clearAuthCookies(reply);
    throw new AppError(401, 'SESSION_REVOKED', 'Your session has ended. Please sign in again.');
  }
  if (record.expiresAt <= new Date() || session.expiresAt <= new Date()) {
    clearAuthCookies(reply);
    throw new AppError(401, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
  }

  const nextToken = newRefreshToken();
  const refreshExpires = refreshExpiry(session.expiresAt);
  // Compare-and-set on usedAt so two concurrent refreshes cannot both succeed.
  await tx(async (db) => {
    const claimed = await db.refreshToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count === 0) throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Please sign in again');
    const next = await db.refreshToken.create({ data: { sessionId: session.id, tokenHash: hash(nextToken), expiresAt: refreshExpires } });
    await db.refreshToken.update({ where: { id: record.id }, data: { replacedById: next.id } });
    await db.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date(), ip: req.ip } });
  });

  const claims: AccessClaims = { sub: session.userId, tid: session.user.tenantId, sid: session.storeId, ses: session.id };
  const accessToken = await signAccess(reply, claims);
  setCookies(reply, accessToken, nextToken, refreshExpires);
  return { claims, accessTokenExpiresAt: new Date(Date.now() + config.ACCESS_TOKEN_TTL_SECONDS * 1000), refreshTokenExpiresAt: refreshExpires, sessionId: session.id };
}

/** Change the session's working store and re-issue the access token with the new store claim. */
export async function switchSessionStore(reply: FastifyReply, claims: AccessClaims, storeId: string) {
  await prisma.session.update({ where: { id: claims.ses }, data: { storeId } });
  const next: AccessClaims = { ...claims, sid: storeId };
  const accessToken = await signAccess(reply, next);
  reply.setCookie(ACCESS_COOKIE, accessToken, { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/', maxAge: config.ACCESS_TOKEN_TTL_SECONDS });
  return next;
}

/** Revoke the session behind a presented refresh token (sign-out when the access token is gone). */
export async function revokeByRefreshToken(token: string | undefined, reason: string) {
  if (!token) return;
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash: hash(token) }, select: { sessionId: true } });
  if (record) await revokeSession(record.sessionId, reason);
}

export async function revokeSession(sessionId: string, reason: string) {
  await prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
}

/** Revoke every active session for a user (password reset, deactivation, "sign out everywhere"). */
export async function revokeAllSessions(userId: string, reason: string, exceptSessionId?: string, db: Db = prisma) {
  const res = await db.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return res.count;
}
