import { marginPct } from '@segue/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission, storeOf } from '../../../core/auth';
import { dayKey, lastDays } from '../../../core/dates';
import { prisma } from '../../../core/db';
import { parse } from '../../../core/errors';
import { effectiveCost } from '../../../core/store-config';

export async function reportsRoutes(app: FastifyInstance) {
  app.get('/reports/sales', { preHandler: requirePermission('office.reports.read') }, async (req) => {
    const storeId = storeOf(req);
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query);
    const since = new Date(Date.now() - days * 86_400_000);
    const [sales, lines] = await Promise.all([
      prisma.sale.findMany({ where: { storeId, createdAt: { gte: since } }, select: { createdAt: true, total: true, type: true, discountTotal: true } }),
      prisma.saleLine.findMany({ where: { sale: { storeId, createdAt: { gte: since } } }, select: { productId: true, prescriptionId: true, lineTotal: true, unitCost: true, quantity: true } }),
    ]);
    const products = await prisma.product.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.productId).filter((x): x is string => !!x))] } }, select: { id: true, category: true } });
    const catOf = new Map(products.map((p) => [p.id, p.category]));
    const byDay = new Map<string, { revenue: number; transactions: number }>();
    for (const s of sales) {
      const d = dayKey(s.createdAt);
      const e = byDay.get(d) ?? { revenue: 0, transactions: 0 };
      e.revenue += s.total;
      if (s.type === 'SALE') e.transactions++;
      byDay.set(d, e);
    }
    const byCategory = new Map<string, { revenue: number; cost: number }>();
    let revenue = 0;
    let cost = 0;
    let scriptRevenue = 0;
    for (const l of lines) {
      if (l.prescriptionId) {
        scriptRevenue += l.lineTotal;
        continue;
      }
      const cat = (l.productId && catOf.get(l.productId)) || 'Other';
      const e = byCategory.get(cat) ?? { revenue: 0, cost: 0 };
      e.revenue += l.lineTotal;
      e.cost += l.unitCost * l.quantity;
      byCategory.set(cat, e);
      revenue += l.lineTotal;
      cost += l.unitCost * l.quantity;
    }
    const daysList = lastDays(days);
    const txCount = sales.filter((s) => s.type === 'SALE').length;
    return {
      revenue: revenue + scriptRevenue,
      retailRevenue: revenue,
      scriptRevenue,
      grossProfit: revenue - cost,
      marginPct: revenue ? marginPct(revenue, cost) : 0,
      transactions: txCount,
      avgBasket: txCount ? Math.round(sales.filter((s) => s.type === 'SALE').reduce((a, s) => a + s.total, 0) / txCount) : 0,
      discounts: sales.reduce((a, s) => a + s.discountTotal, 0),
      byDay: daysList.map((date) => ({ date, ...(byDay.get(date) ?? { revenue: 0, transactions: 0 }) })),
      byCategory: [...byCategory.entries()].map(([category, v]) => ({ category, revenue: v.revenue, grossProfit: v.revenue - v.cost, marginPct: marginPct(v.revenue, v.cost) })).sort((a, b) => b.revenue - a.revenue),
    };
  });

  app.get('/reports/inventory', { preHandler: requirePermission('office.reports.read') }, async (req) => {
    const storeId = storeOf(req);
    const since = new Date(Date.now() - 60 * 86_400_000);
    const [stock, moves] = await Promise.all([
      prisma.storeProduct.findMany({ where: { storeId, product: { isActive: true } }, include: { product: true } }),
      prisma.stockMovement.groupBy({ by: ['productId', 'reason'], where: { storeId, createdAt: { gte: since } }, _sum: { quantity: true } }),
    ]);
    const sold = new Map<string, number>();
    const byReason = new Map<string, number>();
    for (const m of moves) {
      if (m.reason === 'SALE' || m.reason === 'DISPENSE') sold.set(m.productId, (sold.get(m.productId) ?? 0) - (m._sum.quantity ?? 0));
      byReason.set(m.reason, (byReason.get(m.reason) ?? 0) + (m._sum.quantity ?? 0));
    }
    const byCategory = new Map<string, { value: number; units: number; skus: number }>();
    const slow: { name: string; onHand: number; value: number }[] = [];
    let negative = 0;
    for (const sp of stock) {
      const cost = effectiveCost(sp.product, sp);
      const e = byCategory.get(sp.product.category) ?? { value: 0, units: 0, skus: 0 };
      e.value += Math.max(0, sp.onHand) * cost;
      e.units += Math.max(0, sp.onHand);
      e.skus++;
      byCategory.set(sp.product.category, e);
      if (sp.onHand < 0) negative++;
      if (sp.onHand > 0 && !sold.get(sp.productId)) slow.push({ name: sp.product.name, onHand: sp.onHand, value: sp.onHand * cost });
    }
    return {
      byCategory: [...byCategory.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.value - a.value),
      movementsByReason: [...byReason.entries()].map(([reason, quantity]) => ({ reason, quantity })),
      slowMovers: slow.sort((a, b) => b.value - a.value).slice(0, 15),
      negativeStock: negative,
    };
  });
}
