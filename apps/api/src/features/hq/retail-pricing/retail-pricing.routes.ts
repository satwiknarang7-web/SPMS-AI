import { marginPct } from '@segue/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, audit } from '../../../core/audit';
import { requirePermission, tenantOf } from '../../../core/auth';
import { prisma, tx } from '../../../core/db';
import { badRequest, parse, unprocessable } from '../../../core/errors';
import { futureDate } from '../shared/hq.shared';
import { createPublication, type RetailPricePayload } from '../sync/publication.service';

export async function retailPricingRoutes(app: FastifyInstance) {
  app.get('/retail/products', { preHandler: requirePermission('hq.config.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const q = parse(z.object({ q: z.string().optional(), category: z.string().optional() }), req.query);
    const products = await prisma.product.findMany({
      where: { tenantId, department: 'FRONT_SHOP', isActive: true, category: q.category, ...(q.q ? { OR: [{ name: { contains: q.q } }, { sku: { contains: q.q.toUpperCase() } }, { barcode: q.q }] } : {}) },
      include: { stores: { select: { storeId: true, retailPrice: true } } },
      orderBy: { name: 'asc' },
      take: 300,
    });
    return products.map((p) => {
      const storePrices = p.stores.map((s) => s.retailPrice ?? p.retailPrice);
      return {
        id: p.id, sku: p.sku, name: p.name, category: p.category, costPrice: p.costPrice, masterRetailPrice: p.retailPrice, marginPct: marginPct(p.retailPrice, p.costPrice),
        minStorePrice: storePrices.length ? Math.min(...storePrices) : p.retailPrice, maxStorePrice: storePrices.length ? Math.max(...storePrices) : p.retailPrice,
        storesDiffering: p.stores.filter((s) => s.retailPrice != null && s.retailPrice !== p.retailPrice).length,
      };
    });
  });

  app.post('/retail/publish', { preHandler: requirePermission('hq.pricing.write', 'hq.publish') }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(
      z.object({ title: z.string().min(3).optional(), storeIds: z.union([z.literal('ALL'), z.array(z.string()).min(1)]), effectiveAt: futureDate, changes: z.array(z.object({ productId: z.string(), retailPrice: z.number().int() })).min(1).max(1000) }),
      req.body,
    );
    const zero = body.changes.filter((c) => c.retailPrice <= 0);
    if (zero.length) throw unprocessable('Zero or negative prices are not allowed', { productIds: zero.map((z) => z.productId) });
    const products = await prisma.product.findMany({ where: { tenantId, id: { in: body.changes.map((c) => c.productId) } } });
    if (products.length !== body.changes.length) throw badRequest('Unknown product');
    const belowCost = body.changes.filter((c) => c.retailPrice < (products.find((p) => p.id === c.productId)?.costPrice ?? 0));
    if (belowCost.length) throw unprocessable('Some prices are below cost', { productIds: belowCost.map((b) => b.productId) });
    const allStores = body.storeIds === 'ALL';
    const stores = await prisma.store.findMany({ where: { tenantId, status: 'ACTIVE', id: allStores ? undefined : { in: body.storeIds as string[] } } });
    return tx(async (db) => {
      const payload: RetailPricePayload = { allStores, changes: body.changes };
      const pub = await createPublication(db, {
        tenantId, kind: 'RETAIL_PRICE', title: body.title ?? `Retail price update — ${body.changes.length} item(s) to ${allStores ? 'all stores' : `${stores.length} store(s)`}`,
        payload, storeIds: stores.map((s) => s.id), effectiveAt: body.effectiveAt, createdById: req.ctx.userId,
      });
      await audit(db, actorFrom(req), {
        module: 'HQ', action: 'retail.publish', entityType: 'Publication', entityId: pub.id, storeId: null, summary: pub.title,
        before: Object.fromEntries(products.map((p) => [p.sku, p.retailPrice])), after: Object.fromEntries(body.changes.map((c) => [products.find((p) => p.id === c.productId)!.sku, c.retailPrice])),
      });
      return pub;
    });
  });

  /** HQ-RP-03: store active prices that differ from the HQ master. */
  app.get('/retail/inconsistencies', { preHandler: requirePermission('hq.config.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const rows = await prisma.storeProduct.findMany({
      where: { store: { tenantId }, retailPrice: { not: null }, product: { department: 'FRONT_SHOP', isActive: true } },
      include: { store: { select: { id: true, code: true, name: true } }, product: { select: { id: true, sku: true, name: true, retailPrice: true, category: true } } },
    });
    return rows
      .filter((r) => r.retailPrice !== r.product.retailPrice)
      .map((r) => ({ store: r.store, product: r.product, storePrice: r.retailPrice!, masterPrice: r.product.retailPrice, diff: r.retailPrice! - r.product.retailPrice, diffPct: ((r.retailPrice! - r.product.retailPrice) / r.product.retailPrice) * 100 }))
      .sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct));
  });
}
