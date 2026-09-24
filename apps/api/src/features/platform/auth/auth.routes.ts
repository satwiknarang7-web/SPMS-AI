import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../../../config';
import { actorFrom, audit, systemActor } from '../../../core/audit';
import { authenticate, clearAuthCookies, loadContext, REFRESH_COOKIE, revokeAllSessions, revokeByRefreshToken, revokeSession, rotateSession, startSession, switchSessionStore } from '../../../core/auth';
import { prisma, tx } from '../../../core/db';
import { AppError, forbidden, notFound, parse, unauthorized } from '../../../core/errors';
import { authRateLimit } from '../../../core/rate-limit';
import { accessibleStores } from '../../../core/store-config';
import { defaultStoreFor, sessionDocument } from './auth.service';

/** Compared against when the email is unknown, so response timing does not reveal which accounts exist. */
const DUMMY_HASH = bcrypt.hashSync('segue-timing-equaliser', 10);

const loginSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(1),
});

/** Sign-in limiter keyed on IP + email, so one attacker can't lock out a whole store's IP. */
const loginKey = (req: FastifyRequest) => `login:${req.ip}:${String((req.body as { email?: string } | undefined)?.email ?? '').toLowerCase()}`;

export async function authRoutes(app: FastifyInstance) {
  app.post('/login', { config: { rateLimit: authRateLimit(loginKey) } }, async (req, reply) => {
    const body = parse(loginSchema, req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email }, include: { roles: true } });

    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new AppError(423, 'ACCOUNT_LOCKED', `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask an administrator to reset your password.`);
    }

    const ok = await bcrypt.compare(body.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.isActive) {
      if (user) {
        const failed = user.failedLoginCount + 1;
        const lock = failed >= config.LOGIN_MAX_ATTEMPTS;
        await tx(async (db) => {
          await db.user.update({
            where: { id: user.id },
            data: { failedLoginCount: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + config.LOCKOUT_MINUTES * 60_000) : undefined },
          });
          await audit(db, { ...systemActor(user.tenantId), userId: user.id, userName: user.name }, {
            module: 'PLATFORM', action: lock ? 'auth.locked' : 'auth.login_failed', entityType: 'User', entityId: user.id,
            summary: lock ? `Account ${user.email} locked for ${config.LOCKOUT_MINUTES} minutes after ${failed} failed sign-ins` : `Failed sign-in for ${user.email} (${failed}/${config.LOGIN_MAX_ATTEMPTS})`,
          });
        });
      }
      throw unauthorized('Incorrect email or password');
    }

    const storeId = await defaultStoreFor(user);
    const tokens = await startSession(req, reply, user, storeId);
    await tx(async (db) => {
      await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
      await audit(db, { tenantId: user.tenantId, storeId, userId: user.id, userName: user.name, role: null }, {
        module: 'PLATFORM', action: 'auth.login', entityType: 'Session', entityId: tokens.sessionId, summary: `${user.name} signed in`,
      });
    });
    req.ctx = await loadContext({ sub: user.id, tid: user.tenantId, sid: storeId, ses: tokens.sessionId });
    return sessionDocument(req, tokens);
  });

  /** Rotate the refresh token and issue a fresh access token. */
  app.post('/refresh', { config: { rateLimit: authRateLimit((req) => `refresh:${req.ip}`, 60) } }, async (req, reply) => {
    const tokens = await rotateSession(req, reply);
    req.ctx = await loadContext(tokens.claims);
    return sessionDocument(req, tokens);
  });

  /** Sign out this device. Works even with an expired access token (uses the refresh cookie). */
  app.post('/logout', async (req, reply) => {
    await revokeByRefreshToken(req.cookies[REFRESH_COOKIE], 'LOGOUT');
    try {
      const claims = await req.jwtVerify<{ ses?: string }>();
      if (claims.ses) await revokeSession(claims.ses, 'LOGOUT');
    } catch {
      /* access token missing or expired — the refresh cookie above already identified the session */
    }
    clearAuthCookies(reply);
    return { ok: true };
  });

  app.get('/me', { onRequest: authenticate }, async (req) => sessionDocument(req));

  app.post('/switch-store', { onRequest: authenticate }, async (req, reply) => {
    const { storeId } = parse(z.object({ storeId: z.string() }), req.body);
    if (!req.ctx.tenantId) throw forbidden();
    const store = (await accessibleStores(prisma, req.ctx.userId, req.ctx.tenantId)).find((s) => s.id === storeId);
    if (!store) throw forbidden('You do not have access to that store');
    const claims = await switchSessionStore(reply, req.ctx.claims, storeId);
    req.ctx = await loadContext(claims);
    await tx((db) => audit(db, actorFrom(req), { module: 'PLATFORM', action: 'auth.switch_store', entityType: 'Store', entityId: storeId, summary: `Switched to ${store.name}` }));
    return sessionDocument(req);
  });

  /* ------------------------------ My sessions ------------------------------ */

  app.get('/sessions', { onRequest: authenticate }, async (req) => {
    const sessions = await prisma.session.findMany({
      where: { userId: req.ctx.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true, userAgent: true, ip: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    });
    return sessions.map((s) => ({ ...s, current: s.id === req.ctx.sessionId }));
  });

  app.delete<{ Params: { id: string } }>('/sessions/:id', { onRequest: authenticate }, async (req) => {
    const s = await prisma.session.findFirst({ where: { id: req.params.id, userId: req.ctx.userId } });
    if (!s) throw notFound('Session');
    await revokeSession(s.id, 'REVOKED_BY_USER');
    await tx((db) => audit(db, actorFrom(req), { module: 'PLATFORM', action: 'auth.session_revoked', entityType: 'Session', entityId: s.id, summary: `${req.ctx.userName} signed out a device` }));
    return { revoked: true };
  });

  /** Sign out every other device. */
  app.post('/logout-others', { onRequest: authenticate }, async (req) => {
    const count = await revokeAllSessions(req.ctx.userId, 'LOGOUT_OTHERS', req.ctx.sessionId);
    await tx((db) => audit(db, actorFrom(req), { module: 'PLATFORM', action: 'auth.logout_others', entityType: 'User', entityId: req.ctx.userId, summary: `${req.ctx.userName} signed out ${count} other device(s)` }));
    return { revoked: count };
  });
}
