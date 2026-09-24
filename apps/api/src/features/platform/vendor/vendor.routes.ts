import { MODULE_KEYS, SUBSCRIPTION_STATUSES, isSubscriptionUsable } from '@segue/shared';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, audit } from '../../../core/audit';
import { authenticate, requirePlatformAdmin } from '../../../core/auth';
import { prisma, tx } from '../../../core/db';
import { conflict, notFound, parse } from '../../../core/errors';

const subscriptionUpdate = z.object({
  status: z.enum(SUBSCRIPTION_STATUSES),
  expiresAt: z.iso.datetime().nullable().optional(),
  seats: z.number().int().min(0).optional(),
});

const tenantCreate = z.object({
  name: z.string().min(2),
  abn: z.string().optional(),
  store: z.object({ code: z.string().min(2), name: z.string().min(2), suburb: z.string().min(2), state: z.string().min(2) }),
  admin: z.object({ name: z.string().min(2), email: z.email().transform((e) => e.toLowerCase()), password: z.string().min(10) }),
  modules: z.array(z.enum(MODULE_KEYS)).default([]),
});

/** Segue's own licensing console: which tenant has purchased which module. */
export async function vendorRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate);
  app.addHook('preHandler', requirePlatformAdmin);

  app.get('/tenants', async () => {
    const tenants = await prisma.tenant.findMany({
      include: { subscriptions: true, _count: { select: { stores: true, users: true } } },
      orderBy: { name: 'asc' },
    });
    return tenants.map((t) => ({
      id: t.id,
      name: t.name,
      abn: t.abn,
      createdAt: t.createdAt,
      stores: t._count.stores,
      users: t._count.users,
      subscriptions: MODULE_KEYS.map((m) => {
        const s = t.subscriptions.find((x) => x.module === m);
        return { module: m, status: s?.status ?? 'NOT_PURCHASED', expiresAt: s?.expiresAt ?? null, seats: s?.seats ?? 0, usable: s ? isSubscriptionUsable(s) : false };
      }),
    }));
  });

  app.put<{ Params: { id: string; module: string } }>('/tenants/:id/subscriptions/:module', async (req) => {
    const module = parse(z.enum(MODULE_KEYS), req.params.module);
    const body = parse(subscriptionUpdate, req.body);
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
    if (!tenant) throw notFound('Tenant');
    return tx(async (db) => {
      const before = await db.subscription.findUnique({ where: { tenantId_module: { tenantId: tenant.id, module } } });
      const expiresAt = body.expiresAt === undefined ? before?.expiresAt ?? null : body.expiresAt ? new Date(body.expiresAt) : null;
      const sub = await db.subscription.upsert({
        where: { tenantId_module: { tenantId: tenant.id, module } },
        create: { tenantId: tenant.id, module, status: body.status, expiresAt, seats: body.seats ?? 0 },
        update: { status: body.status, expiresAt, seats: body.seats },
      });
      await audit(db, { ...actorFrom(req), tenantId: tenant.id, storeId: null }, {
        module: 'PLATFORM', action: 'licence.update', entityType: 'Subscription', entityId: sub.id,
        summary: `${module} licence set to ${sub.status} by Segue`, before: before ? { status: before.status, expiresAt: before.expiresAt } : null,
        after: { status: sub.status, expiresAt: sub.expiresAt },
      });
      return sub;
    });
  });

  app.post('/tenants', async (req) => {
    const body = parse(tenantCreate, req.body);
    if (await prisma.user.findUnique({ where: { email: body.admin.email } })) throw conflict('Admin email already in use');
    const passwordHash = await bcrypt.hash(body.admin.password, 12);
    return tx(async (db) => {
      const tenant = await db.tenant.create({ data: { name: body.name, abn: body.abn } });
      const store = await db.store.create({ data: { ...body.store, tenantId: tenant.id } });
      await db.user.create({
        data: {
          tenantId: tenant.id, name: body.admin.name, email: body.admin.email, passwordHash,
          roles: { create: [{ role: 'SYSTEM_ADMIN', storeId: null }, { role: 'STORE_MANAGER', storeId: null }] },
        },
      });
      for (const m of body.modules) await db.subscription.create({ data: { tenantId: tenant.id, module: m, status: 'ACTIVE' } });
      await audit(db, { ...actorFrom(req), tenantId: tenant.id, storeId: store.id }, {
        module: 'PLATFORM', action: 'tenant.create', entityType: 'Tenant', entityId: tenant.id, summary: `Tenant ${tenant.name} onboarded`, after: { modules: body.modules },
      });
      return tenant;
    });
  });
}
