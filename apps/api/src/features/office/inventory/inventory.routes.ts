import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, audit } from '../../../core/audit';
import { requirePermission, storeOf, tenantOf } from '../../../core/auth';
import { prisma, tx } from '../../../core/db';
import { notFound, parse } from '../../../core/errors';
import { moveStock } from '../../../core/inventory';
import { effectiveCost } from '../../../core/store-config';

const ADJUST_REASONS = ['ADJUSTMENT', 'WRITE_OFF', 'TRANSFER'] as const;

export async function inventoryRoutes(app: FastifyInstance) {
  app.get('/inventory/movements', { preHandler: requirePermission('office.products.read') }, async (req) => {
    const storeId = storeOf(req);
    const q = parse(z.object({ productId: z.string().optional(), reason: z.string().optional(), take: z.coerce.number().int().max(500).default(100) }), req.query);
    const moves = await prisma.stockMovement.findMany({ where: { storeId, productId: q.productId, reason: q.reason }, orderBy: { createdAt: 'desc' }, take: q.take });
    const [products, users] = await Promise.all([
      prisma.product.findMany({ where: { id: { in: [...new Set(moves.map((m) => m.productId))] } }, select: { id: true, name: true, sku: true } }),
      prisma.user.findMany({ where: { id: { in: [...new Set(moves.map((m) => m.userId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } }),
    ]);
    return moves.map((m) => ({ ...m, product: products.find((p) => p.id === m.productId) ?? null, user: users.find((u) => u.id === m.userId)?.name ?? null }));
  });

  app.post('/inventory/adjust', { preHandler: requirePermission('office.inventory.adjust') }, async (req) => {
    const tenantId = tenantOf(req);
    const storeId = storeOf(req);
    const body = parse(z.object({ productId: z.string(), quantity: z.number().int().refine((n) => n !== 0, 'Quantity cannot be zero'), reason: z.enum(ADJUST_REASONS), note: z.string().min(3, 'A note is required for every adjustment') }), req.body);
    const product = await prisma.product.findFirst({ where: { id: body.productId, tenantId } });
    if (!product) throw notFound('Product');
    return tx(async (db) => {
      const move = await moveStock(db, { storeId, productId: product.id, quantity: body.quantity, reason: body.reason, note: body.note, userId: req.ctx.userId, refType: 'Adjustment' });
      await audit(db, actorFrom(req), { module: 'OFFICE', action: 'inventory.adjust', entityType: 'Product', entityId: product.id, summary: `Stock ${body.quantity > 0 ? '+' : ''}${body.quantity} ${product.name} (${body.reason}): ${body.note}` });
      return move;
    });
  });

  /** Suggested reorder: items at or below reorder point, grouped by primary supplier. */
  app.get('/inventory/reorder', { preHandler: requirePermission('office.products.read') }, async (req) => {
    const storeId = storeOf(req);
    const low = await prisma.storeProduct.findMany({
      where: { storeId, reorderPoint: { gt: 0 }, product: { isActive: true } },
      include: { product: { include: { suppliers: { where: { isPrimary: true }, include: { supplier: true } } } } },
    });
    const open = await prisma.purchaseOrderLine.findMany({ where: { order: { storeId, status: { in: ['DRAFT', 'SUBMITTED', 'PARTIALLY_RECEIVED'] } } }, select: { productId: true, qtyOrdered: true, qtyReceived: true } });
    const onOrder = new Map<string, number>();
    for (const l of open) onOrder.set(l.productId, (onOrder.get(l.productId) ?? 0) + l.qtyOrdered - l.qtyReceived);
    const groups = new Map<string, { supplier: { id: string; name: string; electronic: boolean } | null; items: unknown[] }>();
    for (const sp of low) {
      if (sp.onHand > sp.reorderPoint) continue;
      const pending = onOrder.get(sp.productId) ?? 0;
      const suggested = Math.max(0, (sp.reorderQty || sp.reorderPoint * 2) - pending);
      if (suggested === 0) continue;
      const ps = sp.product.suppliers[0];
      const key = ps?.supplierId ?? 'none';
      const g = groups.get(key) ?? { supplier: ps ? { id: ps.supplier.id, name: ps.supplier.name, electronic: ps.supplier.electronic } : null, items: [] };
      g.items.push({ productId: sp.productId, name: sp.product.name, sku: sp.product.sku, onHand: sp.onHand, reorderPoint: sp.reorderPoint, onOrder: pending, suggested, unitCost: ps?.cost ?? effectiveCost(sp.product, sp) });
      groups.set(key, g);
    }
    return [...groups.values()];
  });
}
