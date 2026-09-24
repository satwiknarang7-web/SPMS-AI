import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, audit } from '../../../core/audit';
import { requirePermission, storeOf, tenantOf } from '../../../core/auth';
import { json, prisma, tx } from '../../../core/db';
import { conflict, notFound, parse, unprocessable } from '../../../core/errors';
import { moveStock } from '../../../core/inventory';
import { nextNumber } from '../../../core/store-config';
import { priceCart } from '../shared/pos.service';
import { loadShift } from '../shared/pos.shared';

export async function laybysRoutes(app: FastifyInstance) {
  app.get('/laybys', { preHandler: requirePermission('pos.layby') }, async (req) => {
    const storeId = storeOf(req);
    const laybys = await prisma.layby.findMany({ where: { storeId }, orderBy: { createdAt: 'desc' }, take: 100 });
    const customers = await prisma.customer.findMany({ where: { id: { in: laybys.map((l) => l.customerId) } }, select: { id: true, name: true, phone: true } });
    return laybys.map((l) => ({ ...l, items: json.parse(l.items, []), payments: json.parse(l.payments, []), customer: customers.find((c) => c.id === l.customerId) ?? null }));
  });

  app.post('/laybys', { preHandler: requirePermission('pos.layby') }, async (req) => {
    const tenantId = tenantOf(req);
    const storeId = storeOf(req);
    const body = parse(
      z.object({ shiftId: z.string(), customerId: z.string(), items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive() })).min(1), deposit: z.number().int().positive(), weeks: z.number().int().min(1).max(26).default(8) }),
      req.body,
    );
    const shift = await loadShift(req, body.shiftId);
    if (shift.status !== 'OPEN') throw conflict('Open a shift first');
    return tx(async (db) => {
      const quote = await priceCart(db, tenantId, storeId, body.items);
      const total = quote.totals.total;
      if (body.deposit < Math.ceil(total * 0.1)) throw unprocessable('Minimum layby deposit is 10%');
      if (body.deposit > total) throw unprocessable('Deposit exceeds the layby total');
      const number = await nextNumber(() => db.layby.count({ where: { storeId } }), 'LB', 5);
      const layby = await db.layby.create({
        data: {
          storeId, number, customerId: body.customerId, total, paid: body.deposit, dueDate: new Date(Date.now() + body.weeks * 7 * 86_400_000),
          status: body.deposit >= total ? 'COMPLETED' : 'ACTIVE',
          items: json.stringify(quote.lines.map((l) => ({ productId: l.productId, description: l.description, quantity: l.quantity, unitPrice: Math.round(l.lineTotal / l.quantity) }))),
          payments: json.stringify([{ amount: body.deposit, at: new Date() }]),
        },
      });
      // Goods are set aside (removed from saleable stock) when the layby is opened.
      for (const l of quote.lines) if (l.productId) await moveStock(db, { storeId, productId: l.productId, quantity: -l.quantity, reason: 'LAYBY', refType: 'Layby', refId: layby.id, userId: req.ctx.userId });
      await db.cashEvent.create({ data: { shiftId: shift.id, type: 'LAYBY', amount: body.deposit, reason: `Layby ${number} deposit`, userId: req.ctx.userId } });
      await audit(db, actorFrom(req), { module: 'POS', action: 'layby.create', entityType: 'Layby', entityId: layby.id, summary: `Layby ${number} opened: ${(total / 100).toFixed(2)}, deposit ${(body.deposit / 100).toFixed(2)}` });
      return layby;
    });
  });

  app.post<{ Params: { id: string } }>('/laybys/:id/payment', { preHandler: requirePermission('pos.layby') }, async (req) => {
    const storeId = storeOf(req);
    const body = parse(z.object({ shiftId: z.string(), amount: z.number().int().positive() }), req.body);
    const shift = await loadShift(req, body.shiftId);
    if (shift.status !== 'OPEN') throw conflict('Open a shift first');
    return tx(async (db) => {
      const layby = await db.layby.findFirst({ where: { id: req.params.id, storeId } });
      if (!layby) throw notFound('Layby');
      if (layby.status !== 'ACTIVE') throw conflict('Layby is not active');
      if (layby.paid + body.amount > layby.total) throw unprocessable(`Payment exceeds the balance of ${((layby.total - layby.paid) / 100).toFixed(2)}`);
      const paid = layby.paid + body.amount;
      const payments = [...json.parse<unknown[]>(layby.payments, []), { amount: body.amount, at: new Date() }];
      const updated = await db.layby.update({ where: { id: layby.id }, data: { paid, payments: json.stringify(payments), status: paid >= layby.total ? 'COMPLETED' : 'ACTIVE' } });
      await db.cashEvent.create({ data: { shiftId: shift.id, type: 'LAYBY', amount: body.amount, reason: `Layby ${layby.number} payment`, userId: req.ctx.userId } });
      await audit(db, actorFrom(req), { module: 'POS', action: 'layby.payment', entityType: 'Layby', entityId: layby.id, summary: `Layby ${layby.number} payment ${(body.amount / 100).toFixed(2)}${updated.status === 'COMPLETED' ? ' — paid in full, ready for pickup' : ''}` });
      return updated;
    });
  });

  app.post<{ Params: { id: string } }>('/laybys/:id/cancel', { preHandler: requirePermission('pos.layby') }, async (req) => {
    const storeId = storeOf(req);
    const body = parse(z.object({ shiftId: z.string(), reason: z.string().min(3), cancellationFee: z.number().int().min(0).default(0) }), req.body);
    const shift = await loadShift(req, body.shiftId);
    return tx(async (db) => {
      const layby = await db.layby.findFirst({ where: { id: req.params.id, storeId } });
      if (!layby) throw notFound('Layby');
      if (layby.status !== 'ACTIVE') throw conflict('Only active laybys can be cancelled');
      const refund = Math.max(0, layby.paid - body.cancellationFee);
      for (const item of json.parse<{ productId: string | null; quantity: number }[]>(layby.items, [])) {
        if (item.productId) await moveStock(db, { storeId, productId: item.productId, quantity: item.quantity, reason: 'RETURN', refType: 'Layby', refId: layby.id, userId: req.ctx.userId, note: 'Layby cancelled' });
      }
      if (refund) await db.cashEvent.create({ data: { shiftId: shift.id, type: 'LAYBY', amount: -refund, reason: `Layby ${layby.number} cancellation refund`, userId: req.ctx.userId } });
      const updated = await db.layby.update({ where: { id: layby.id }, data: { status: 'CANCELLED' } });
      await audit(db, actorFrom(req), { module: 'POS', action: 'layby.cancel', entityType: 'Layby', entityId: layby.id, summary: `Layby ${layby.number} cancelled (${body.reason}); refunded ${(refund / 100).toFixed(2)}` });
      return updated;
    });
  });
}
