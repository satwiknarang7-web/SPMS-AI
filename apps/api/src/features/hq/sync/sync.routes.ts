import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom } from '../../../core/audit';
import { requireAnyPermission, requirePermission, tenantOf } from '../../../core/auth';
import { json, prisma } from '../../../core/db';
import { notFound, parse } from '../../../core/errors';
import { collectStoreMetrics } from '../../../jobs/metrics';
import { rollbackPublication, republishToStore, runSync } from './publication.service';

export async function syncRoutes(app: FastifyInstance) {
  app.get('/sync/publications', { preHandler: requirePermission('hq.config.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const { kind } = parse(z.object({ kind: z.string().optional() }), req.query);
    const pubs = await prisma.publication.findMany({ where: { tenantId, kind }, include: { targets: { select: { status: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
    const users = await prisma.user.findMany({ where: { id: { in: [...new Set(pubs.map((p) => p.createdById))] } }, select: { id: true, name: true } });
    return pubs.map(({ targets, payload: _p, rollback: _r, ...p }) => ({
      ...p,
      createdBy: users.find((u) => u.id === p.createdById)?.name ?? null,
      scheduled: p.effectiveAt > new Date(),
      counts: targets.reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.status]: (acc[t.status] ?? 0) + 1 }), {}),
      total: targets.length,
    }));
  });

  app.get<{ Params: { id: string } }>('/sync/publications/:id', { preHandler: requirePermission('hq.config.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const pub = await prisma.publication.findFirst({ where: { id: req.params.id, tenantId }, include: { targets: true } });
    if (!pub) throw notFound('Publication');
    const stores = await prisma.store.findMany({ where: { id: { in: pub.targets.map((t) => t.storeId) } }, select: { id: true, code: true, name: true, online: true, status: true } });
    return { ...pub, payload: json.parse(pub.payload, {}), targets: pub.targets.map(({ previous: _prev, ...t }) => ({ ...t, store: stores.find((s) => s.id === t.storeId) ?? null })) };
  });

  app.post<{ Params: { id: string } }>('/sync/publications/:id/republish', { preHandler: requirePermission('hq.publish') }, async (req) => {
    const tenantId = tenantOf(req);
    const { storeId } = parse(z.object({ storeId: z.string() }), req.body);
    const result = await republishToStore(actorFrom(req), tenantId, req.params.id, storeId);
    await runSync({ tenantId, force: true });
    return result;
  });

  app.post<{ Params: { id: string } }>('/sync/publications/:id/rollback', { preHandler: requirePermission('hq.publish') }, async (req) => {
    const tenantId = tenantOf(req);
    const result = await rollbackPublication(actorFrom(req), tenantId, req.params.id, req.ctx.userId);
    await runSync({ tenantId, force: true });
    return result;
  });

  app.post('/sync/run', { preHandler: requirePermission('hq.publish') }, async (req) => runSync({ tenantId: tenantOf(req), force: true }));

  app.post('/sync/collect', { preHandler: requireAnyPermission('hq.reports.read', 'hq.publish') }, async (req) => collectStoreMetrics({ tenantId: tenantOf(req), days: 2 }));
}
