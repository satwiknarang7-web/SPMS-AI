import { marginPct } from '@segue/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, audit } from '../../../core/audit';
import { requirePermission, storeOf, tenantOf } from '../../../core/auth';
import { prisma, tx } from '../../../core/db';
import { badRequest, parse, unprocessable } from '../../../core/errors';
import { effectiveCost, effectiveRetail } from '../../../core/store-config';

export async function pricingRoutes(app: FastifyInstance) {
  app.get('/pricing/review', { preHandler: requirePermission('office.products.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const storeId = storeOf(req);
    const q = parse(z.object({ category: z.string().optional(), q: z.string().optional(), filter: z.enum(['all', 'low-margin', 'zero', 'differs-from-hq']).default('all'), threshold: z.coerce.number().default(25) }), req.query);
    const products = await prisma.product.findMany({
      where: { tenantId, isActive: true, department: 'FRONT_SHOP', category: q.category, ...(q.q ? { OR: [{ name: { contains: q.q } }, { sku: { contains: q.q.toUpperCase() } }] } : {}) },
      include: { stores: { where: { storeId } } },
      orderBy: { name: 'asc' },
    });
    const rows = products.map((p) => {
      const sp = p.stores[0];
      const retail = effectiveRetail(p, sp);
      const cost = effectiveCost(p, sp);
      return { id: p.id, sku: p.sku, name: p.name, category: p.category, costPrice: cost, retailPrice: retail, masterRetailPrice: p.retailPrice, storeOverride: sp?.retailPrice != null, marginPct: marginPct(retail, cost), priceLevel: p.priceLevel };
    });
    return rows.filter((r) =>
      q.filter === 'low-margin' ? r.marginPct < q.threshold : q.filter === 'zero' ? r.retailPrice <= 0 : q.filter === 'differs-from-hq' ? r.retailPrice !== r.masterRetailPrice : true,
    );
  });

  /** Bulk, audited store price update with zero-price protection. */
  app.post('/pricing/review', { preHandler: requirePermission('office.pricing.write') }, async (req) => {
    const tenantId = tenantOf(req);
    const storeId = storeOf(req);
    const body = parse(z.object({ reason: z.string().min(3), changes: z.array(z.object({ productId: z.string(), retailPrice: z.number().int() })).min(1).max(500) }), req.body);
    const zero = body.changes.filter((c) => c.retailPrice <= 0);
    if (zero.length) throw unprocessable('Zero or negative prices are not allowed', { productIds: zero.map((z) => z.productId) });
    const products = await prisma.product.findMany({ where: { tenantId, id: { in: body.changes.map((c) => c.productId) } }, include: { stores: { where: { storeId } } } });
    if (products.length !== body.changes.length) throw badRequest('Unknown product in price changes');

    return tx(async (db) => {
      const summary: string[] = [];
      for (const c of body.changes) {
        const p = products.find((x) => x.id === c.productId)!;
        const old = effectiveRetail(p, p.stores[0]);
        if (old === c.retailPrice) continue;
        await db.storeProduct.upsert({
          where: { storeId_productId: { storeId, productId: p.id } },
          create: { storeId, productId: p.id, retailPrice: c.retailPrice },
          update: { retailPrice: c.retailPrice },
        });
        await db.priceHistory.create({ data: { productId: p.id, storeId, oldRetail: old, newRetail: c.retailPrice, source: 'OFFICE_REVIEW', userId: req.ctx.userId } });
        summary.push(`${p.name}: ${(old / 100).toFixed(2)} → ${(c.retailPrice / 100).toFixed(2)}`);
      }
      await audit(db, actorFrom(req), {
        module: 'OFFICE', action: 'pricing.review', entityType: 'PriceReview', summary: `Pricing review applied to ${summary.length} item(s): ${body.reason}`, after: { changes: summary },
      });
      return { updated: summary.length };
    });
  });
}
