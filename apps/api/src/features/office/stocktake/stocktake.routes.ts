import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorFrom, audit } from '../../../core/audit';
import { requirePermission, storeOf, tenantOf } from '../../../core/auth';
import { prisma, tx } from '../../../core/db';
import { badRequest, conflict, notFound, parse } from '../../../core/errors';
import { moveStock } from '../../../core/inventory';

export async function stocktakeRoutes(app: FastifyInstance) {
  app.get('/stocktakes', { preHandler: requirePermission('office.products.read') }, async (req) => {
    const storeId = storeOf(req);
    const takes = await prisma.stocktake.findMany({ where: { storeId }, include: { counts: { select: { systemQty: true, countedQty: true } } }, orderBy: { createdAt: 'desc' } });
    return takes.map(({ counts, ...t }) => ({
      ...t,
      items: counts.length,
      counted: counts.filter((c) => c.countedQty != null).length,
      varianceUnits: counts.reduce((s, c) => s + (c.countedQty != null ? c.countedQty - c.systemQty : 0), 0),
    }));
  });

  app.post('/stocktakes', { preHandler: requirePermission('office.stocktake.write') }, async (req) => {
    const tenantId = tenantOf(req);
    const storeId = storeOf(req);
    const body = parse(z.object({ name: z.string().min(2), category: z.string().optional().nullable() }), req.body);
    if (await prisma.stocktake.findFirst({ where: { storeId, status: { in: ['COUNTING', 'REVIEW'] }, category: body.category ?? null } })) throw conflict('A stocktake for this scope is already in progress');
    const products = await prisma.product.findMany({ where: { tenantId, isActive: true, category: body.category ?? undefined }, include: { stores: { where: { storeId } } } });
    return tx(async (db) => {
      const take = await db.stocktake.create({
        data: {
          storeId, name: body.name, scope: body.category ? 'CATEGORY' : 'FULL', category: body.category ?? null, createdById: req.ctx.userId,
          counts: { create: products.map((p) => ({ productId: p.id, systemQty: p.stores[0]?.onHand ?? 0 })) },
        },
      });
      await audit(db, actorFrom(req), { module: 'OFFICE', action: 'stocktake.create', entityType: 'Stocktake', entityId: take.id, summary: `Stocktake "${take.name}" started (${products.length} items)` });
      return take;
    });
  });

  app.get<{ Params: { id: string } }>('/stocktakes/:id', { preHandler: requirePermission('office.products.read') }, async (req) => {
    const take = await loadStocktake(req, req.params.id);
    const products = await prisma.product.findMany({ where: { id: { in: take.counts.map((c) => c.productId) } }, select: { id: true, name: true, sku: true, barcode: true, category: true, costPrice: true } });
    return {
      ...take,
      counts: take.counts
        .map((c) => {
          const p = products.find((x) => x.id === c.productId);
          const variance = c.countedQty != null ? c.countedQty - c.systemQty : null;
          return { ...c, product: p ?? null, variance, varianceValue: variance != null && p ? variance * p.costPrice : null };
        })
        .sort((a, b) => (a.product?.name ?? '').localeCompare(b.product?.name ?? '')),
    };
  });

  /** Record counts. `mode: add` appends to an existing count (multi-session / multiple counters). */
  app.put<{ Params: { id: string } }>('/stocktakes/:id/counts', { preHandler: requirePermission('office.stocktake.write') }, async (req) => {
    const body = parse(z.object({ mode: z.enum(['set', 'add']).default('set'), counts: z.array(z.object({ productId: z.string(), quantity: z.number().int().min(0) })).min(1) }), req.body);
    const take = await loadStocktake(req, req.params.id);
    if (take.status !== 'COUNTING') throw conflict('Counting is closed for this stocktake');
    return tx(async (db) => {
      for (const c of body.counts) {
        const row = take.counts.find((x) => x.productId === c.productId);
        if (!row) throw badRequest('Product is not in this stocktake scope');
        await db.stocktakeCount.update({ where: { id: row.id }, data: { countedQty: body.mode === 'add' ? (row.countedQty ?? 0) + c.quantity : c.quantity } });
      }
      return { updated: body.counts.length };
    });
  });

  app.post<{ Params: { id: string } }>('/stocktakes/:id/review', { preHandler: requirePermission('office.stocktake.write') }, async (req) => {
    const take = await loadStocktake(req, req.params.id);
    if (take.status !== 'COUNTING') throw conflict('Stocktake is not counting');
    return prisma.stocktake.update({ where: { id: take.id }, data: { status: 'REVIEW' } });
  });

  /**
   * Post variances as STOCKTAKE movements. Stock that moved (sales, dispensing) after the
   * snapshot is respected: the adjustment is counted − snapshot, not counted − current.
   */
  app.post<{ Params: { id: string } }>('/stocktakes/:id/post', { preHandler: requirePermission('office.stocktake.write') }, async (req) => {
    const storeId = storeOf(req);
    const body = parse(z.object({ reasonCodes: z.record(z.string(), z.string()).default({}) }), req.body ?? {});
    const take = await loadStocktake(req, req.params.id);
    if (!['COUNTING', 'REVIEW'].includes(take.status)) throw conflict('Stocktake already finalised');
    return tx(async (db) => {
      let adjusted = 0;
      let value = 0;
      for (const c of take.counts) {
        if (c.countedQty == null) continue;
        const variance = c.countedQty - c.systemQty;
        if (variance === 0) continue;
        const reason = body.reasonCodes[c.productId] ?? 'UNEXPLAINED';
        await db.stocktakeCount.update({ where: { id: c.id }, data: { reasonCode: reason } });
        await moveStock(db, { storeId, productId: c.productId, quantity: variance, reason: 'STOCKTAKE', refType: 'Stocktake', refId: take.id, userId: req.ctx.userId, note: reason });
        const p = await db.product.findUnique({ where: { id: c.productId }, select: { costPrice: true } });
        value += variance * (p?.costPrice ?? 0);
        adjusted++;
      }
      const posted = await db.stocktake.update({ where: { id: take.id }, data: { status: 'POSTED', postedAt: new Date() } });
      await audit(db, actorFrom(req), { module: 'OFFICE', action: 'stocktake.post', entityType: 'Stocktake', entityId: take.id, summary: `Stocktake "${take.name}" posted: ${adjusted} variance line(s), value ${(value / 100).toFixed(2)}` });
      return { stocktake: posted, adjusted, varianceValue: value };
    });
  });
}

async function loadStocktake(req: FastifyRequest, id: string) {
  const take = await prisma.stocktake.findFirst({ where: { id, storeId: storeOf(req) }, include: { counts: true } });
  if (!take) throw notFound('Stocktake');
  return take;
}
