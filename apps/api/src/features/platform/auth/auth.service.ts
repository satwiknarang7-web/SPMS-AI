import { isSubscriptionUsable, MODULES, ROLE_LABELS } from '@segue/shared';
import type { FastifyRequest } from 'fastify';
import { prisma } from '../../../core/db';
import { accessibleStores } from '../../../core/store-config';

/** The session document the web app bootstraps from (GET /api/auth/me and every auth response). */
export async function sessionDocument(req: FastifyRequest, tokens?: { accessTokenExpiresAt: Date; refreshTokenExpiresAt?: Date }) {
  const { ctx } = req;
  const [tenant, stores] = await Promise.all([
    ctx.tenantId ? prisma.tenant.findUnique({ where: { id: ctx.tenantId }, include: { subscriptions: true } }) : null,
    ctx.tenantId ? accessibleStores(prisma, ctx.userId, ctx.tenantId) : [],
  ]);
  return {
    user: { id: ctx.userId, name: ctx.userName, email: ctx.email, isPlatformAdmin: ctx.isPlatformAdmin },
    tenant: tenant ? { id: tenant.id, name: tenant.name } : null,
    stores: stores.map((s) => ({ id: s.id, code: s.code, name: s.name, suburb: s.suburb, state: s.state })),
    storeId: ctx.storeId,
    sessionId: ctx.sessionId,
    roles: ctx.roles.map((r) => ({ key: r, label: ROLE_LABELS[r] })),
    modules: ctx.modules,
    subscriptions: (tenant?.subscriptions ?? []).map((s) => ({
      module: s.module,
      name: MODULES[s.module as keyof typeof MODULES]?.name ?? s.module,
      status: s.status,
      expiresAt: s.expiresAt,
      usable: isSubscriptionUsable(s),
    })),
    permissions: [...ctx.permissions],
    ...(tokens ? { accessTokenExpiresAt: tokens.accessTokenExpiresAt, refreshTokenExpiresAt: tokens.refreshTokenExpiresAt } : {}),
  };
}

/** Default working store at sign-in: the user's first store-scoped role, else the first store they can access. */
export async function defaultStoreFor(user: { id: string; tenantId: string | null; roles: { storeId: string | null }[] }) {
  if (!user.tenantId) return null;
  const stores = await accessibleStores(prisma, user.id, user.tenantId);
  return user.roles.find((r) => r.storeId)?.storeId ?? stores[0]?.id ?? null;
}
