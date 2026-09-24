import { PRICING_CONDITIONS, resolveDispenseRule, sortByPrecedence } from '@segue/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, audit } from '../../../core/audit';
import { requirePermission, tenantOf } from '../../../core/auth';
import { prisma, tx } from '../../../core/db';
import { badRequest, conflict, forbidden, notFound, parse } from '../../../core/errors';
import { activePromotions, appliedDispenseRules, drugConfigForStore, storeGroups } from '../../../core/store-config';
import { runSync } from '../sync/publication.service';

export async function storesRoutes(app: FastifyInstance) {
  app.get('/stores', { preHandler: requirePermission('hq.config.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const stores = await prisma.store.findMany({ where: { tenantId }, include: { groups: { include: { group: true } } }, orderBy: { code: 'asc' } });
    const pending = await prisma.publicationTarget.groupBy({ by: ['storeId', 'status'], where: { publication: { tenantId, status: 'PUBLISHED' }, status: { in: ['QUEUED', 'FAILED'] } }, _count: true });
    return stores.map((s) => ({
      ...s,
      groups: sortByPrecedence(s.groups.map((g) => g.group)).map((g) => ({ id: g.id, name: g.name, priority: g.priority })),
      queued: pending.find((p) => p.storeId === s.id && p.status === 'QUEUED')?._count ?? 0,
      failed: pending.find((p) => p.storeId === s.id && p.status === 'FAILED')?._count ?? 0,
    }));
  });

  const storeBody = z.object({ code: z.string().min(2).transform((s) => s.toUpperCase()), name: z.string().min(2), suburb: z.string().min(2), state: z.enum(['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT']), groupIds: z.array(z.string()).default([]) });

  app.post('/stores', { preHandler: requirePermission('hq.stores.manage') }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(storeBody, req.body);
    if (await prisma.store.findFirst({ where: { tenantId, code: body.code } })) throw conflict('Store code already in use');
    return tx(async (db) => {
      const store = await db.store.create({ data: { tenantId, code: body.code, name: body.name, suburb: body.suburb, state: body.state, groups: { create: body.groupIds.map((groupId) => ({ groupId })) } } });
      // Range the full catalogue at the new store with zero stock.
      const products = await db.product.findMany({ where: { tenantId }, select: { id: true } });
      await db.storeProduct.createMany({ data: products.map((p) => ({ storeId: store.id, productId: p.id })) });
      await audit(db, actorFrom(req), { module: 'HQ', action: 'store.enrol', entityType: 'Store', entityId: store.id, storeId: store.id, summary: `Store ${store.code} ${store.name} enrolled`, after: body });
      return store;
    });
  });

  app.patch<{ Params: { id: string } }>('/stores/:id', { preHandler: requirePermission('hq.stores.manage') }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(z.object({ name: z.string().min(2), suburb: z.string().min(2), state: z.string().min(2), status: z.enum(['ACTIVE', 'SUSPENDED']), groupIds: z.array(z.string()) }).partial(), req.body);
    const existing = await prisma.store.findFirst({ where: { id: req.params.id, tenantId }, include: { groups: true } });
    if (!existing) throw notFound('Store');
    return tx(async (db) => {
      const { groupIds, ...fields } = body;
      if (groupIds) {
        const valid = await db.storeGroup.count({ where: { tenantId, id: { in: groupIds } } });
        if (valid !== new Set(groupIds).size) throw badRequest('Unknown group');
        await db.storeGroupMember.deleteMany({ where: { storeId: existing.id } });
        await db.storeGroupMember.createMany({ data: groupIds.map((groupId) => ({ storeId: existing.id, groupId })) });
      }
      const store = await db.store.update({ where: { id: existing.id }, data: fields });
      await audit(db, actorFrom(req), {
        module: 'HQ', action: body.status && body.status !== existing.status ? `store.${body.status === 'SUSPENDED' ? 'suspend' : 'reinstate'}` : 'store.update',
        entityType: 'Store', entityId: store.id, storeId: store.id, summary: `Store ${store.code} updated`,
        before: { ...pickKeys(existing, Object.keys(fields)), groupIds: existing.groups.map((g) => g.groupId) }, after: body,
      });
      return store;
    });
  });

  app.delete<{ Params: { id: string } }>('/stores/:id', { preHandler: requirePermission('hq.stores.manage') }, async (req) => {
    const tenantId = tenantOf(req);
    const store = await prisma.store.findFirst({ where: { id: req.params.id, tenantId } });
    if (!store) throw notFound('Store');
    const [sales, scripts] = await Promise.all([prisma.sale.count({ where: { storeId: store.id } }), prisma.prescription.count({ where: { storeId: store.id } })]);
    if (sales || scripts) throw conflict('This store has trading and dispensing history, which must be retained. Suspend it instead.');
    return tx(async (db) => {
      await db.store.delete({ where: { id: store.id } });
      await audit(db, actorFrom(req), { module: 'HQ', action: 'store.remove', entityType: 'Store', entityId: store.id, storeId: null, summary: `Store ${store.code} ${store.name} removed`, before: store });
      return { removed: true };
    });
  });

  /** Simulates the store agent's connectivity so offline queueing and retry can be demonstrated. */
  app.post<{ Params: { id: string } }>('/stores/:id/connectivity', { preHandler: requirePermission('hq.stores.manage') }, async (req) => {
    const tenantId = tenantOf(req);
    const { online } = parse(z.object({ online: z.boolean() }), req.body);
    const store = await prisma.store.findFirst({ where: { id: req.params.id, tenantId } });
    if (!store) throw notFound('Store');
    const updated = await prisma.store.update({ where: { id: store.id }, data: { online, lastSeenAt: online ? new Date() : store.lastSeenAt } });
    if (online) await runSync({ tenantId, force: true });
    return updated;
  });

  app.get('/groups', { preHandler: requirePermission('hq.config.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const groups = await prisma.storeGroup.findMany({ where: { tenantId }, include: { members: { include: { store: { select: { id: true, code: true, name: true } } } } } });
    const strategies = await prisma.rankingStrategy.findMany({ where: { tenantId } });
    return sortByPrecedence(groups).map((g) => ({ ...g, members: g.members.map((m) => m.store), rankingBasis: strategies.find((s) => s.groupId === g.id)?.basis ?? null }));
  });

  const groupBody = z.object({ name: z.string().min(2), description: z.string().optional().nullable(), priority: z.number().int().min(1).max(1000), storeIds: z.array(z.string()) });

  app.post('/groups', { preHandler: requirePermission('hq.stores.manage') }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(groupBody, req.body);
    return tx(async (db) => {
      const group = await db.storeGroup.create({ data: { tenantId, name: body.name, description: body.description, priority: body.priority, members: { create: body.storeIds.map((storeId) => ({ storeId })) } } });
      await audit(db, actorFrom(req), { module: 'HQ', action: 'group.create', entityType: 'StoreGroup', entityId: group.id, storeId: null, summary: `Store group "${group.name}" created (priority ${group.priority})`, after: body });
      return group;
    });
  });

  app.patch<{ Params: { id: string } }>('/groups/:id', { preHandler: requirePermission('hq.stores.manage') }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(groupBody.partial(), req.body);
    const existing = await prisma.storeGroup.findFirst({ where: { id: req.params.id, tenantId }, include: { members: true } });
    if (!existing) throw notFound('Store group');
    return tx(async (db) => {
      const { storeIds, ...fields } = body;
      if (storeIds) {
        await db.storeGroupMember.deleteMany({ where: { groupId: existing.id } });
        await db.storeGroupMember.createMany({ data: storeIds.map((storeId) => ({ storeId, groupId: existing.id })) });
      }
      const group = await db.storeGroup.update({ where: { id: existing.id }, data: fields });
      await audit(db, actorFrom(req), {
        module: 'HQ', action: 'group.update', entityType: 'StoreGroup', entityId: group.id, storeId: null, summary: `Store group "${group.name}" updated`,
        before: { name: existing.name, priority: existing.priority, storeIds: existing.members.map((m) => m.storeId) }, after: body,
      });
      return group;
    });
  });

  app.delete<{ Params: { id: string } }>('/groups/:id', { preHandler: requirePermission('hq.stores.manage') }, async (req) => {
    const tenantId = tenantOf(req);
    const group = await prisma.storeGroup.findFirst({ where: { id: req.params.id, tenantId } });
    if (!group) throw notFound('Store group');
    const inUse = await prisma.dispensePricingRule.count({ where: { groupId: group.id, status: { in: ['PUBLISHED', 'SCHEDULED'] } } });
    if (inUse) throw conflict('Group has published pricing rules. Roll them back first.');
    return tx(async (db) => {
      await db.storeGroup.delete({ where: { id: group.id } });
      await audit(db, actorFrom(req), { module: 'HQ', action: 'group.delete', entityType: 'StoreGroup', entityId: group.id, storeId: null, summary: `Store group "${group.name}" deleted` });
      return { deleted: true };
    });
  });

  /**
   * The configuration actually in effect at a store, and why (HQ-SG-04). Store managers use
   * this for a read-only view of what applies to their store.
   */
  app.get<{ Params: { id: string } }>('/stores/:id/effective-config', { preHandler: requirePermission('hq.config.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const store = await prisma.store.findFirst({ where: { id: req.params.id, tenantId } });
    if (!store) throw notFound('Store');
    const isStoreOnly = !req.ctx.permissions.has('hq.reports.read') && !req.ctx.permissions.has('hq.stores.manage');
    if (isStoreOnly && req.ctx.storeId !== store.id) throw forbidden('You can only view the configuration for your own store');
    const [groups, rules, cfg, promos, pending] = await Promise.all([
      storeGroups(prisma, store.id),
      appliedDispenseRules(prisma, tenantId, store.id),
      drugConfigForStore(prisma, store.id),
      activePromotions(prisma, tenantId, store.id),
      prisma.publicationTarget.findMany({ where: { storeId: store.id, status: { in: ['QUEUED', 'FAILED'] }, publication: { status: 'PUBLISHED' } }, include: { publication: { select: { title: true, kind: true, effectiveAt: true } } } }),
    ]);
    const ruleRows = await prisma.dispensePricingRule.findMany({ where: { id: { in: rules.map((r) => r.id) } } });
    const groupName = (id: string | null) => groups.find((g) => g.id === id)?.name ?? null;
    const resolution = PRICING_CONDITIONS.map((condition) => {
      const winner = resolveDispenseRule(rules, groups, condition, null);
      const candidates = rules.filter((r) => r.condition === condition && r.drugClass == null);
      const classRules = rules.filter((r) => r.condition === condition && r.drugClass != null);
      return {
        condition,
        winner: winner ? { ...ruleRows.find((r) => r.id === winner.id), groupName: groupName(winner.groupId) } : null,
        overridden: candidates.filter((c) => c.id !== winner?.id).map((c) => ({ ...ruleRows.find((r) => r.id === c.id), groupName: groupName(c.groupId) })),
        classRules: classRules.map((c) => ({ ...ruleRows.find((r) => r.id === c.id), groupName: groupName(c.groupId) })),
      };
    });
    return {
      store,
      groups,
      precedenceRule: 'Lowest priority number wins; ties go to the group created first.',
      ranking: { basis: cfg.basis, fromGroup: groupName(cfg.strategyGroupId), flaggedItems: cfg.flags.size },
      pricing: resolution,
      promotions: promos,
      pending: pending.map((p) => ({ title: p.publication.title, kind: p.publication.kind, status: p.status, attempts: p.attempts, error: p.error, effectiveAt: p.publication.effectiveAt })),
    };
  });
}

function pickKeys(obj: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}
