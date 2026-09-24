import { effectivePermissions, isRole, licensedModules, type ModuleKey, type Permission, type Role } from '@segue/shared';
import type { FastifyRequest } from 'fastify';
import { prisma } from '../db';
import { AppError, unauthorized } from '../errors';
import type { AccessClaims } from './tokens';

/** Everything the rest of the API needs to know about who is calling, resolved per request. */
export interface RequestContext {
  userId: string;
  userName: string;
  email: string;
  isPlatformAdmin: boolean;
  tenantId: string | null;
  tenantName: string | null;
  storeId: string | null;
  sessionId: string;
  /** Roles in effect for the selected store (tenant-wide roles + roles scoped to this store). */
  roles: Role[];
  modules: ModuleKey[];
  permissions: Set<Permission>;
  claims: AccessClaims;
}

declare module 'fastify' {
  interface FastifyRequest {
    ctx: RequestContext;
  }
}

/**
 * Verifies the access token (httpOnly cookie, or `Authorization: Bearer` for non-browser
 * clients), then loads the caller's context fresh from the database. Because the session,
 * user, roles and licences are re-read on every request, a sign-out, deactivation, role
 * change or licence suspension takes effect immediately — not when the token expires.
 */
export async function authenticate(req: FastifyRequest): Promise<void> {
  let claims: AccessClaims;
  try {
    claims = await req.jwtVerify<AccessClaims>();
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    // The client refreshes on TOKEN_EXPIRED and retries once.
    if (/EXPIRED/i.test(code) || /expired/i.test((err as Error).message)) throw new AppError(401, 'TOKEN_EXPIRED', 'Access token expired');
    throw unauthorized();
  }
  if (!claims.ses) throw unauthorized();
  req.ctx = await loadContext(claims);
}

export async function loadContext(claims: AccessClaims): Promise<RequestContext> {
  const [user, session] = await Promise.all([
    prisma.user.findUnique({ where: { id: claims.sub }, include: { roles: true, tenant: { include: { subscriptions: true } } } }),
    prisma.session.findUnique({ where: { id: claims.ses }, select: { userId: true, revokedAt: true, expiresAt: true } }),
  ]);
  if (!session || session.userId !== claims.sub || session.revokedAt || session.expiresAt <= new Date()) {
    throw new AppError(401, 'SESSION_REVOKED', 'Your session has ended. Please sign in again.');
  }
  if (!user || !user.isActive) throw unauthorized('Your account is no longer active');

  const storeId = claims.sid;
  const roles = [...new Set(user.roles.filter((r) => r.storeId === null || r.storeId === storeId).map((r) => r.role).filter(isRole))];
  const modules = user.tenant ? licensedModules(user.tenant.subscriptions) : [];

  return {
    userId: user.id,
    userName: user.name,
    email: user.email,
    isPlatformAdmin: user.isPlatformAdmin,
    tenantId: user.tenantId,
    tenantName: user.tenant?.name ?? null,
    storeId,
    sessionId: claims.ses,
    roles,
    modules,
    permissions: new Set(effectivePermissions(roles, modules)),
    claims,
  };
}
