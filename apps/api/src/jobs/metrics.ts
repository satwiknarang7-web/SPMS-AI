import { prisma, tx } from '../core/db';
import { dayKey, lastDays } from '../core/dates';
import { effectiveCost } from '../core/store-config';

/**
 * Scheduled collection of store data for HQ reporting (HQ-SY-04).
 *
 * Produces one de-identified aggregate row per store per business day. HQ reporting reads
 * only these rows — never patient-level data — which is how the "HQ must not hold or display
 * patient-identifying clinical data" constraint is enforced structurally.
 */
export async function collectStoreMetrics(opts: { tenantId?: string; days?: number } = {}) {
  const days = lastDays(opts.days ?? 2);
  const stores = await prisma.store.findMany({ where: { tenantId: opts.tenantId } });
  const from = new Date(Date.now() - (days.length + 1) * 86_400_000);
  let rows = 0;

  for (const store of stores) {
    const [sales, scripts, stock] = await Promise.all([
      prisma.sale.findMany({
        where: { storeId: store.id, createdAt: { gte: from } },
        select: { createdAt: true, type: true, lines: { select: { productId: true, prescriptionId: true, lineTotal: true, unitCost: true, quantity: true, promotionId: true } } },
      }),
      prisma.prescription.findMany({
        where: { storeId: store.id, dispensedAt: { gte: from } },
        select: { dispensedAt: true, scriptType: true, patientPrice: true, governmentContribution: true },
      }),
      prisma.storeProduct.findMany({ where: { storeId: store.id, product: { isActive: true } }, include: { product: { select: { costPrice: true, category: true } } } }),
    ]);
    const categoryOf = new Map(stock.map((s) => [s.productId, s.product.category]));
    const stockValue = stock.reduce((sum, sp) => sum + Math.max(0, sp.onHand) * effectiveCost(sp.product, sp), 0);
    const stockouts = stock.filter((sp) => sp.reorderPoint > 0 && sp.onHand <= 0).length;
    const today = dayKey(new Date());

    for (const day of days) {
      const m = { retailSales: 0, retailCost: 0, transactions: 0, scripts: 0, pbsScripts: 0, scriptRevenue: 0, promoSales: 0, categorySales: {} as Record<string, number> };
      for (const s of sales) {
        if (dayKey(s.createdAt) !== day) continue;
        if (s.type === 'SALE') m.transactions++;
        for (const l of s.lines) {
          if (l.prescriptionId) continue; // script revenue is counted from the dispensing record
          m.retailSales += l.lineTotal;
          m.retailCost += l.unitCost * l.quantity;
          if (l.promotionId) m.promoSales += l.lineTotal;
          const cat = (l.productId && categoryOf.get(l.productId)) || 'Other';
          m.categorySales[cat] = (m.categorySales[cat] ?? 0) + l.lineTotal;
        }
      }
      for (const s of scripts) {
        if (dayKey(s.dispensedAt!) !== day) continue;
        m.scripts++;
        if (s.scriptType !== 'PRIVATE') m.pbsScripts++;
        m.scriptRevenue += (s.patientPrice ?? 0) + (s.governmentContribution ?? 0);
      }
      const snapshot = day === today ? { stockValue, stockouts } : {};
      await tx((db) =>
        db.storeDailyMetric.upsert({
          where: { storeId_date: { storeId: store.id, date: day } },
          create: { tenantId: store.tenantId, storeId: store.id, date: day, ...m, categorySales: JSON.stringify(m.categorySales), stockValue, stockouts },
          update: { ...m, categorySales: JSON.stringify(m.categorySales), ...snapshot, collectedAt: new Date() },
        }),
      );
      rows++;
    }
  }
  return { stores: stores.length, rows };
}
