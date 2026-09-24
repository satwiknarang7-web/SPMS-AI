import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAnyPermission, tenantOf } from '../../../core/auth';
import { prisma } from '../../../core/db';
import { parse } from '../../../core/errors';
import { activePromotions, effectiveRetail, promotionFor } from '../../../core/store-config';

export async function catalogueRoutes(app: FastifyInstance) {
  // Products are shared by every module; any product-facing permission may read them.

  const catalogueGuard = requireAnyPermission('office.products.read', 'pos.sell', 'dispense.scripts.read', 'hq.config.read');

  app.get('/catalogue/products', { preHandler: catalogueGuard }, async (req) => {
    const tenantId = tenantOf(req);
    const q = parse(z.object({ q: z.string().optional(), category: z.string().optional(), take: z.coerce.number().int().max(200).default(40) }), req.query);
    const storeId = req.ctx.storeId;
    const term = q.q?.trim();
    const products = await prisma.product.findMany({
      where: {
        tenantId,
        isActive: true,
        category: q.category,
        ...(term ? { OR: [{ name: { contains: term } }, { barcode: term }, { sku: { contains: term } }, { brand: { contains: term } }] } : {}),
      },
      include: storeId ? { stores: { where: { storeId } } } : undefined,
      orderBy: { name: 'asc' },
      take: q.take,
    });
    const promos = storeId ? await activePromotions(prisma, tenantId, storeId) : [];
    return products.map((p) => {
      const sp = (p as typeof p & { stores?: { onHand: number; retailPrice: number | null }[] }).stores?.[0];
      const price = effectiveRetail(p, sp);
      const promo = promotionFor(p.id, price, promos);
      return {
        id: p.id, sku: p.sku, barcode: p.barcode, name: p.name, brand: p.brand, category: p.category, department: p.department,
        gstFree: p.gstFree, hotkeyColor: p.hotkeyColor, retailPrice: price, masterRetailPrice: p.retailPrice, costPrice: p.costPrice,
        onHand: sp?.onHand ?? 0, promotion: promo ? { id: promo.promo.id, name: promo.promo.name, price: promo.price } : null,
      };
    });
  });

  app.get('/catalogue/categories', { preHandler: catalogueGuard }, async (req) => {
    const rows = await prisma.product.groupBy({ by: ['category'], where: { tenantId: tenantOf(req) }, _count: true, orderBy: { category: 'asc' } });
    return rows.map((r) => ({ category: r.category, count: r._count }));
  });

  app.get('/stores', async (req) => {
    const tenantId = tenantOf(req);
    return prisma.store.findMany({ where: { tenantId }, select: { id: true, code: true, name: true, suburb: true, state: true, status: true }, orderBy: { code: 'asc' } });
  });
}
