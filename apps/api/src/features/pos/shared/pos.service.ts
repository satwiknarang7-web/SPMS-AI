import { cartTotals, checkMargin, type MarginCheck } from '@segue/shared';
import type { Db } from '../../../core/db';
import { badRequest, conflict, notFound } from '../../../core/errors';
import { activePromotions, effectiveCost, effectiveRetail, promotionFor, tenantSettings } from '../../../core/store-config';

export interface QuoteLineInput {
  productId?: string | null;
  prescriptionId?: string | null;
  quantity: number;
  /** Manual discount for the whole line, in cents. */
  discount?: number;
}

export interface PricedLine {
  key: string;
  productId: string | null;
  prescriptionId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  promoDiscount: number;
  manualDiscount: number;
  discount: number;
  lineTotal: number;
  gstFree: boolean;
  isPbs: boolean;
  promotion: { id: string; name: string } | null;
  margin: MarginCheck | null;
  onHand: number | null;
}

/**
 * Server-authoritative pricing of a cart. The client may display a cart, but prices,
 * promotions and margin rules are always recomputed here before a sale is written.
 */
export async function priceCart(db: Db, tenantId: string, storeId: string, lines: readonly QuoteLineInput[]) {
  const settings = await tenantSettings(db, tenantId);
  const promos = await activePromotions(db, tenantId, storeId);
  const productIds = lines.map((l) => l.productId).filter((x): x is string => !!x);
  const scriptIds = lines.map((l) => l.prescriptionId).filter((x): x is string => !!x);
  if (new Set(scriptIds).size !== scriptIds.length) throw badRequest('A prescription can only be added to the cart once');

  const [products, scripts] = await Promise.all([
    db.product.findMany({ where: { tenantId, id: { in: productIds } }, include: { stores: { where: { storeId } } } }),
    db.prescription.findMany({ where: { storeId, id: { in: scriptIds } }, include: { drug: true, patient: { select: { firstName: true, lastName: true } } } }),
  ]);

  const priced: PricedLine[] = lines.map((l, i) => {
    if (l.prescriptionId) {
      const s = scripts.find((x) => x.id === l.prescriptionId);
      if (!s) throw notFound('Prescription');
      if (s.status !== 'READY') throw conflict(`Script ${s.number} is not ready for collection (${s.status})`);
      const price = s.patientPrice ?? 0;
      return {
        key: `rx-${s.id}`,
        productId: null,
        prescriptionId: s.id,
        description: `Rx ${s.number} · ${s.drug.brandName} ${s.drug.strength} · ${s.patient.firstName} ${s.patient.lastName}`,
        quantity: 1,
        unitPrice: price,
        unitCost: 0,
        promoDiscount: 0,
        manualDiscount: 0,
        discount: 0,
        lineTotal: price,
        gstFree: true, // prescription medicines are GST-free
        isPbs: s.scriptType === 'PBS' || s.scriptType === 'RPBS',
        promotion: null,
        margin: null,
        onHand: null,
      };
    }
    const p = products.find((x) => x.id === l.productId);
    if (!p) throw notFound('Product');
    if (!p.isActive) throw conflict(`${p.name} is inactive and cannot be sold`);
    if (l.quantity <= 0) throw badRequest('Quantity must be positive');
    const sp = p.stores[0];
    const unitPrice = effectiveRetail(p, sp);
    const unitCost = effectiveCost(p, sp);
    const promo = promotionFor(p.id, unitPrice, promos);
    const promoDiscount = promo ? (unitPrice - promo.price) * l.quantity : 0;
    const gross = unitPrice * l.quantity;
    const manualDiscount = Math.min(Math.max(0, l.discount ?? 0), gross - promoDiscount);
    const discount = promoDiscount + manualDiscount;
    const lineTotal = gross - discount;
    const margin = checkMargin(Math.round(lineTotal / l.quantity), unitCost, settings.marginThresholdPct);
    return {
      key: `p-${p.id}-${i}`,
      productId: p.id,
      prescriptionId: null,
      description: p.name,
      quantity: l.quantity,
      unitPrice,
      unitCost,
      promoDiscount,
      manualDiscount,
      discount,
      lineTotal,
      gstFree: p.gstFree,
      isPbs: false,
      promotion: promo ? { id: promo.promo.id, name: promo.promo.name } : null,
      margin,
      onHand: sp?.onHand ?? 0,
    };
  });

  const totals = cartTotals(priced.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity, discount: l.discount, gstFree: l.gstFree, isPbs: l.isPbs })));
  // Only manually discounted lines trigger margin protection; HQ promotions are pre-approved.
  const belowCost = priced.filter((l) => l.manualDiscount > 0 && l.margin?.level === 'BELOW_COST');
  const lowMargin = priced.filter((l) => l.manualDiscount > 0 && l.margin?.level === 'LOW_MARGIN');
  return { lines: priced, totals, surchargePct: settings.surchargePct, belowCost: belowCost.map((l) => l.key), lowMargin: lowMargin.map((l) => l.key), settings };
}

export interface ShiftSummary {
  salesCount: number;
  refundCount: number;
  grossSales: number;
  refunds: number;
  discounts: number;
  surcharge: number;
  gst: number;
  byTender: Record<string, number>;
  cashSales: number;
  cashRefunds: number;
  paidIn: number;
  paidOut: number;
  otherCashIn: number;
  noSales: number;
  scriptsCollected: number;
}

export async function summariseShifts(db: Db, where: { shiftId?: string; storeId?: string; from?: Date; to?: Date }): Promise<ShiftSummary> {
  const sales = await db.sale.findMany({
    where: {
      shiftId: where.shiftId,
      storeId: where.storeId,
      createdAt: where.from || where.to ? { gte: where.from, lte: where.to } : undefined,
    },
    include: { payments: true, lines: { select: { prescriptionId: true } } },
  });
  const events = await db.cashEvent.findMany({
    where: where.shiftId ? { shiftId: where.shiftId } : { shift: { storeId: where.storeId }, createdAt: { gte: where.from, lte: where.to } },
  });
  const s: ShiftSummary = {
    salesCount: 0, refundCount: 0, grossSales: 0, refunds: 0, discounts: 0, surcharge: 0, gst: 0, byTender: {},
    cashSales: 0, cashRefunds: 0, paidIn: 0, paidOut: 0, otherCashIn: 0, noSales: 0, scriptsCollected: 0,
  };
  for (const sale of sales) {
    if (sale.type === 'SALE') {
      s.salesCount++;
      s.grossSales += sale.total;
      s.discounts += sale.discountTotal;
      s.scriptsCollected += sale.lines.filter((l) => l.prescriptionId).length;
    } else {
      s.refundCount++;
      s.refunds += -sale.total;
    }
    s.surcharge += sale.surcharge;
    s.gst += sale.gst;
    for (const p of sale.payments) {
      s.byTender[p.tender] = (s.byTender[p.tender] ?? 0) + p.amount;
      if (p.tender === 'CASH') {
        if (p.amount >= 0) s.cashSales += p.amount;
        else s.cashRefunds += -p.amount;
      }
    }
  }
  for (const e of events) {
    if (e.type === 'PAID_IN') s.paidIn += e.amount;
    else if (e.type === 'PAID_OUT') s.paidOut += e.amount;
    else if (e.type === 'NO_SALE') s.noSales++;
    else s.otherCashIn += e.amount; // layby payments, hire deposits (net of refunds)
  }
  return s;
}
