import { cardSurcharge, settleTenders, TENDER_TYPES } from '@segue/shared';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { actorFrom, audit } from '../../../core/audit';
import { hasPermission, requirePermission, storeOf, tenantOf } from '../../../core/auth';
import { prisma, tx } from '../../../core/db';
import { badRequest, conflict, notFound, parse, unprocessable } from '../../../core/errors';
import { moveStock } from '../../../core/inventory';
import { nextNumber } from '../../../core/store-config';
import { priceCart } from '../shared/pos.service';
import { loadShift } from '../shared/pos.shared';

const cartLine = z
  .object({
    productId: z.string().optional().nullable(),
    prescriptionId: z.string().optional().nullable(),
    quantity: z.number().int().positive().default(1),
    discount: z.number().int().min(0).default(0),
  })
  .refine((l) => !!l.productId !== !!l.prescriptionId, 'Each line needs either a product or a prescription');

const saleBody = z.object({
  shiftId: z.string(),
  lines: z.array(cartLine).min(1, 'The cart is empty'),
  tenders: z.array(z.object({ type: z.enum(TENDER_TYPES), amount: z.number().int().positive(), reference: z.string().optional() })).min(1),
  customerId: z.string().optional().nullable(),
  receiptEmail: z.email().optional().nullable().or(z.literal('')),
  overrideReason: z.string().min(3).optional().nullable(),
});

const refundBody = z.object({
  shiftId: z.string(),
  lines: z.array(z.object({ lineId: z.string(), quantity: z.number().int().positive() })).min(1),
  tender: z.enum(['CASH', 'EFTPOS', 'STORE_CREDIT', 'ACCOUNT']),
  reason: z.string().min(3),
  restock: z.boolean().default(true),
});

/** Simulated integrated EFTPOS terminal: returns a tokenised reference, never card data. */
const terminalReference = () => `TXN-${randomBytes(5).toString('hex').toUpperCase()}`;

export async function salesRoutes(app: FastifyInstance) {
  app.post('/quote', { preHandler: requirePermission('pos.sell') }, async (req) => {
    const { lines } = parse(z.object({ lines: z.array(cartLine) }), req.body);
    if (lines.length === 0) return { lines: [], totals: { subtotal: 0, discountTotal: 0, total: 0, gst: 0, pbsTotal: 0, nonPbsTotal: 0 }, surchargePct: 0, belowCost: [], lowMargin: [] };
    const { settings: _s, ...quote } = await priceCart(prisma, tenantOf(req), storeOf(req), lines);
    return quote;
  });

  app.post('/sales', { preHandler: requirePermission('pos.sell') }, async (req) => {
    const tenantId = tenantOf(req);
    const storeId = storeOf(req);
    const body = parse(saleBody, req.body);
    const shift = await loadShift(req, body.shiftId);
    if (shift.status !== 'OPEN') throw conflict('Open a shift before trading');

    return tx(async (db) => {
      const quote = await priceCart(db, tenantId, storeId, body.lines);
      if (quote.belowCost.length) {
        if (!hasPermission(req, 'pos.discount.override')) throw unprocessable('A discount takes an item below cost — a manager override is required', { lines: quote.belowCost });
        if (!body.overrideReason) throw unprocessable('Enter a reason for the below-cost override', { lines: quote.belowCost });
      }

      // Tenders cover the goods total. The card surcharge is then added on top of the card
      // charge, calculated only on the non-PBS portion the card is paying for.
      const settle = settleTenders(quote.totals.total, body.tenders);
      if (!settle.ok) throw unprocessable(settle.error ?? 'Invalid tender', { amountDue: quote.totals.total, outstanding: settle.outstanding });
      const cardAmount = body.tenders.filter((t) => t.type === 'EFTPOS').reduce((s, t) => s + t.amount, 0);
      const surcharge = cardSurcharge(cardAmount, quote.totals.nonPbsTotal, quote.surchargePct);
      const amountDue = quote.totals.total + surcharge;
      const firstCard = body.tenders.findIndex((t) => t.type === 'EFTPOS');

      const customer = body.customerId ? await db.customer.findFirst({ where: { id: body.customerId, tenantId } }) : null;
      if (body.customerId && !customer) throw notFound('Customer');
      const accountAmount = body.tenders.filter((t) => t.type === 'ACCOUNT').reduce((s, t) => s + t.amount, 0);
      if (accountAmount > 0) {
        if (!customer?.hasAccount) throw unprocessable('Select an account customer to charge to account');
        if (customer.creditLimit > 0 && customer.balance + accountAmount > customer.creditLimit) throw unprocessable('This charge exceeds the customer credit limit');
      }

      const number = await nextNumber(() => db.sale.count({ where: { storeId } }), 'S', 7);
      const sale = await db.sale.create({
        data: {
          storeId, shiftId: shift.id, number, customerId: customer?.id ?? null, cashierId: req.ctx.userId,
          subtotal: quote.totals.subtotal, discountTotal: quote.totals.discountTotal, surcharge, gst: quote.totals.gst, total: amountDue,
          receiptEmail: body.receiptEmail || null,
          lines: {
            create: quote.lines.map((l) => ({
              productId: l.productId, prescriptionId: l.prescriptionId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice,
              unitCost: l.unitCost, discount: l.discount, lineTotal: l.lineTotal, gstFree: l.gstFree, isPbs: l.isPbs, promotionId: l.promotion?.id ?? null,
            })),
          },
          payments: {
            create: body.tenders.map((t, i) => ({
              tender: t.type,
              // Cash is recorded net of change so the drawer reconciles; the surcharge rides on the card charge.
              amount: t.type === 'CASH' ? t.amount - settle.change : i === firstCard ? t.amount + surcharge : t.amount,
              reference: t.type === 'EFTPOS' ? terminalReference() : t.reference ?? null,
            })),
          },
        },
        include: { lines: true, payments: true },
      });

      for (const l of quote.lines) {
        if (l.productId) await moveStock(db, { storeId, productId: l.productId, quantity: -l.quantity, reason: 'SALE', refType: 'Sale', refId: sale.id, userId: req.ctx.userId });
        if (l.prescriptionId) {
          await db.prescription.update({ where: { id: l.prescriptionId }, data: { status: 'COLLECTED', collectedAt: new Date(), saleId: sale.id } });
          await audit(db, actorFrom(req), { module: 'POS', action: 'script.collect', entityType: 'Prescription', entityId: l.prescriptionId, summary: `Collected and paid at POS on sale ${number}`, before: { status: 'READY' }, after: { status: 'COLLECTED' } });
        }
      }
      if (customer) {
        const points = Math.floor(((quote.totals.total - quote.totals.pbsTotal) / 100) * quote.settings.loyaltyPointsPerDollar);
        await db.customer.update({ where: { id: customer.id }, data: { points: { increment: points }, balance: { increment: accountAmount } } });
        if (accountAmount) await db.accountTransaction.create({ data: { customerId: customer.id, type: 'CHARGE', amount: accountAmount, saleId: sale.id, userId: req.ctx.userId, note: `Sale ${number}` } });
      }
      await audit(db, actorFrom(req), {
        module: 'POS', action: 'sale.complete', entityType: 'Sale', entityId: sale.id,
        summary: `Sale ${number} ${(amountDue / 100).toFixed(2)} (${body.tenders.map((t) => t.type).join(' + ')})${body.overrideReason ? ` — override: ${body.overrideReason}` : ''}`,
        after: { total: amountDue, surcharge, lines: sale.lines.length, overrides: quote.belowCost.length },
      });
      return { sale, change: settle.change, surcharge, lowMargin: quote.lowMargin };
    });
  });

  app.get('/sales', { preHandler: requirePermission('pos.sell') }, async (req) => {
    const storeId = storeOf(req);
    const { q, take } = parse(z.object({ q: z.string().optional(), take: z.coerce.number().int().max(200).default(50) }), req.query);
    return prisma.sale.findMany({
      where: { storeId, ...(q ? { number: { contains: q.toUpperCase() } } : {}) },
      include: { payments: true, _count: { select: { lines: true } } },
      orderBy: { createdAt: 'desc' },
      take,
    });
  });

  app.get<{ Params: { id: string } }>('/sales/:id', { preHandler: requirePermission('pos.sell') }, async (req) => {
    const storeId = storeOf(req);
    const sale = await prisma.sale.findFirst({ where: { storeId, OR: [{ id: req.params.id }, { number: req.params.id.toUpperCase() }] }, include: { lines: true, payments: true } });
    if (!sale) throw notFound('Sale');
    const [cashier, customer, store, refunds] = await Promise.all([
      prisma.user.findUnique({ where: { id: sale.cashierId }, select: { name: true } }),
      sale.customerId ? prisma.customer.findUnique({ where: { id: sale.customerId } }) : null,
      prisma.store.findUnique({ where: { id: storeId } }),
      prisma.sale.findMany({ where: { originalSaleId: sale.id }, select: { id: true, number: true, total: true, createdAt: true } }),
    ]);
    return { ...sale, cashier: cashier?.name, customer, store, refunds };
  });

  /** Returns and refunds against an original receipt. Dispensed medicines cannot be returned to stock. */
  app.post<{ Params: { id: string } }>('/sales/:id/refund', { preHandler: requirePermission('pos.refund') }, async (req) => {
    const storeId = storeOf(req);
    const body = parse(refundBody, req.body);
    const shift = await loadShift(req, body.shiftId);
    if (shift.status !== 'OPEN') throw conflict('Open a shift before processing refunds');
    const original = await prisma.sale.findFirst({ where: { id: req.params.id, storeId, type: 'SALE' }, include: { lines: true } });
    if (!original) throw notFound('Sale');

    return tx(async (db) => {
      let refundTotal = 0;
      let gst = 0;
      const refundLines: { productId: string | null; description: string; quantity: number; unitPrice: number; lineTotal: number; gstFree: boolean; lineId: string }[] = [];
      for (const r of body.lines) {
        const line = original.lines.find((l) => l.id === r.lineId);
        if (!line) throw badRequest('Line does not belong to this sale');
        if (line.prescriptionId) throw unprocessable('Dispensed prescription medicines cannot be refunded at the register — refer to the pharmacist');
        if (r.quantity > line.quantity - line.refundedQty) throw unprocessable(`Only ${line.quantity - line.refundedQty} of "${line.description}" can be refunded`);
        const perUnit = Math.round(line.lineTotal / line.quantity);
        const amount = perUnit * r.quantity;
        refundTotal += amount;
        if (!line.gstFree) gst += Math.round(amount / 11);
        refundLines.push({ productId: line.productId, description: line.description, quantity: r.quantity, unitPrice: perUnit, lineTotal: amount, gstFree: line.gstFree, lineId: line.id });
      }
      if (body.tender === 'ACCOUNT' && !original.customerId) throw unprocessable('Original sale has no account customer');

      const number = await nextNumber(() => db.sale.count({ where: { storeId } }), 'S', 7);
      const refund = await db.sale.create({
        data: {
          storeId, shiftId: shift.id, number, type: 'RETURN', originalSaleId: original.id, customerId: original.customerId, cashierId: req.ctx.userId,
          subtotal: -refundTotal, discountTotal: 0, gst: -gst, total: -refundTotal,
          lines: { create: refundLines.map(({ lineId: _l, ...l }) => ({ ...l, quantity: -l.quantity, lineTotal: -l.lineTotal })) },
          payments: { create: [{ tender: body.tender, amount: -refundTotal, reference: body.tender === 'EFTPOS' ? terminalReference() : null }] },
        },
        include: { lines: true, payments: true },
      });
      for (const l of refundLines) {
        await db.saleLine.update({ where: { id: l.lineId }, data: { refundedQty: { increment: l.quantity } } });
        if (l.productId && body.restock) await moveStock(db, { storeId, productId: l.productId, quantity: l.quantity, reason: 'RETURN', refType: 'Sale', refId: refund.id, userId: req.ctx.userId, note: body.reason });
      }
      if (body.tender === 'ACCOUNT' && original.customerId) {
        await db.customer.update({ where: { id: original.customerId }, data: { balance: { decrement: refundTotal } } });
        await db.accountTransaction.create({ data: { customerId: original.customerId, type: 'ADJUSTMENT', amount: -refundTotal, saleId: refund.id, userId: req.ctx.userId, note: `Refund ${number}` } });
      }
      const fresh = await db.saleLine.findMany({ where: { saleId: original.id } });
      const fully = fresh.every((l) => l.prescriptionId || l.refundedQty >= l.quantity);
      await db.sale.update({ where: { id: original.id }, data: { status: fully ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
      await audit(db, actorFrom(req), {
        module: 'POS', action: 'sale.refund', entityType: 'Sale', entityId: original.id,
        summary: `Refund ${number} of ${(refundTotal / 100).toFixed(2)} against ${original.number} (${body.tender}) — ${body.reason}${body.restock ? '' : ' — not restocked'}`,
      });
      return refund;
    });
  });
}
