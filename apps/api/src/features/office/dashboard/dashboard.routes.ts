import { marginPct } from '@segue/shared';
import type { FastifyInstance } from 'fastify';
import { requirePermission, storeOf } from '../../../core/auth';
import { prisma } from '../../../core/db';
import { effectiveCost, effectiveRetail } from '../../../core/store-config';

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard', { preHandler: requirePermission('office.reports.read') }, async (req) => {
    const storeId = storeOf(req);
    const since7 = new Date(Date.now() - 7 * 86_400_000);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [stock, openOrders, sales7, salesToday, lines7] = await Promise.all([
      prisma.storeProduct.findMany({ where: { storeId, product: { isActive: true } }, include: { product: true } }),
      prisma.purchaseOrder.count({ where: { storeId, status: { in: ['SUBMITTED', 'PARTIALLY_RECEIVED'] } } }),
      prisma.sale.aggregate({ where: { storeId, createdAt: { gte: since7 } }, _sum: { total: true }, _count: true }),
      prisma.sale.aggregate({ where: { storeId, createdAt: { gte: startOfDay } }, _sum: { total: true }, _count: true }),
      prisma.saleLine.findMany({ where: { sale: { storeId, createdAt: { gte: since7 } }, productId: { not: null } }, select: { productId: true, description: true, lineTotal: true, unitCost: true, quantity: true } }),
    ]);
    let stockValue = 0;
    let retailValue = 0;
    const low: { productId: string; name: string; onHand: number; reorderPoint: number }[] = [];
    for (const sp of stock) {
      stockValue += Math.max(0, sp.onHand) * effectiveCost(sp.product, sp);
      retailValue += Math.max(0, sp.onHand) * effectiveRetail(sp.product, sp);
      if (sp.reorderPoint > 0 && sp.onHand <= sp.reorderPoint) low.push({ productId: sp.productId, name: sp.product.name, onHand: sp.onHand, reorderPoint: sp.reorderPoint });
    }
    const byProduct = new Map<string, { name: string; revenue: number; cost: number; units: number }>();
    let revenue = 0;
    let cost = 0;
    for (const l of lines7) {
      const e = byProduct.get(l.productId!) ?? { name: l.description, revenue: 0, cost: 0, units: 0 };
      e.revenue += l.lineTotal;
      e.cost += l.unitCost * l.quantity;
      e.units += l.quantity;
      byProduct.set(l.productId!, e);
      revenue += l.lineTotal;
      cost += l.unitCost * l.quantity;
    }
    return {
      stockValue,
      retailValue,
      skuCount: stock.length,
      lowStockCount: low.length,
      lowStock: low.sort((a, b) => a.onHand - b.onHand).slice(0, 8),
      openOrders,
      sales7: { total: sales7._sum.total ?? 0, count: sales7._count },
      salesToday: { total: salesToday._sum.total ?? 0, count: salesToday._count },
      retailMarginPct: revenue ? marginPct(revenue, cost) : 0,
      topProducts: [...byProduct.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8),
    };
  });
}
