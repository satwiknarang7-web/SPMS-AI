import { expectedCash } from '@segue/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, audit } from '../../../core/audit';
import { hasPermission, requirePermission, storeOf } from '../../../core/auth';
import { prisma, tx } from '../../../core/db';
import { conflict, forbidden, parse } from '../../../core/errors';
import { summariseShifts } from '../shared/pos.service';
import { loadShift } from '../shared/pos.shared';

export async function shiftsRoutes(app: FastifyInstance) {
  app.get('/shift/current', { preHandler: requirePermission('pos.sell') }, async (req) => {
    const storeId = storeOf(req);
    const { register } = parse(z.object({ register: z.string().default('Register 1') }), req.query);
    const shift = await prisma.shift.findFirst({ where: { storeId, register, status: 'OPEN' } });
    if (!shift) return { shift: null };
    return { shift, summary: await summariseShifts(prisma, { shiftId: shift.id }) };
  });

  app.post('/shift/open', { preHandler: requirePermission('pos.sell') }, async (req) => {
    const storeId = storeOf(req);
    const body = parse(z.object({ register: z.string().min(1), openingFloat: z.number().int().min(0) }), req.body);
    return tx(async (db) => {
      if (await db.shift.findFirst({ where: { storeId, register: body.register, status: 'OPEN' } })) throw conflict(`${body.register} already has an open shift`);
      const shift = await db.shift.create({ data: { storeId, register: body.register, openingFloat: body.openingFloat, openedById: req.ctx.userId } });
      await audit(db, actorFrom(req), { module: 'POS', action: 'shift.open', entityType: 'Shift', entityId: shift.id, summary: `${body.register} opened with float ${(body.openingFloat / 100).toFixed(2)}` });
      return shift;
    });
  });

  /** X-Report: interim snapshot, does not close the shift. */
  app.get<{ Params: { id: string } }>('/shift/:id/x-report', { preHandler: requirePermission('pos.sell') }, async (req) => {
    const shift = await loadShift(req, req.params.id);
    const summary = await summariseShifts(prisma, { shiftId: shift.id });
    return { type: 'X', shift, summary, expectedCash: expectedFor(shift.openingFloat, summary), generatedAt: new Date() };
  });

  /** Z-Report: end-of-day closure with counted cash and variance. */
  app.post<{ Params: { id: string } }>('/shift/:id/close', { preHandler: requirePermission('pos.shift.manage') }, async (req) => {
    const { countedCash, notes } = parse(z.object({ countedCash: z.number().int().min(0), notes: z.string().optional() }), req.body);
    const shift = await loadShift(req, req.params.id);
    if (shift.status !== 'OPEN') throw conflict('Shift is already closed');
    return tx(async (db) => {
      const summary = await summariseShifts(db, { shiftId: shift.id });
      const expected = expectedFor(shift.openingFloat, summary);
      const closed = await db.shift.update({ where: { id: shift.id }, data: { status: 'CLOSED', closedAt: new Date(), closedById: req.ctx.userId, countedCash, expectedCash: expected } });
      await audit(db, actorFrom(req), {
        module: 'POS', action: 'shift.close', entityType: 'Shift', entityId: shift.id,
        summary: `${shift.register} closed (Z-Report). Expected ${(expected / 100).toFixed(2)}, counted ${(countedCash / 100).toFixed(2)}${notes ? ` — ${notes}` : ''}`,
        after: { expected, countedCash, variance: countedCash - expected },
      });
      return { type: 'Z', shift: closed, summary, expectedCash: expected, countedCash, variance: countedCash - expected, generatedAt: new Date() };
    });
  });

  /** ZZ-Report: consolidated period audit across all registers in the store. */
  app.get('/reports/zz', { preHandler: requirePermission('pos.shift.manage') }, async (req) => {
    const storeId = storeOf(req);
    const q = parse(z.object({ from: z.coerce.date(), to: z.coerce.date() }), req.query);
    const to = new Date(q.to);
    to.setHours(23, 59, 59, 999);
    const [summary, shifts] = await Promise.all([
      summariseShifts(prisma, { storeId, from: q.from, to }),
      prisma.shift.findMany({ where: { storeId, openedAt: { gte: q.from, lte: to } }, orderBy: { openedAt: 'desc' } }),
    ]);
    const variance = shifts.reduce((s, x) => s + (x.countedCash != null && x.expectedCash != null ? x.countedCash - x.expectedCash : 0), 0);
    return { type: 'ZZ', from: q.from, to, summary, shifts, totalVariance: variance, generatedAt: new Date() };
  });

  app.post<{ Params: { id: string } }>('/shift/:id/cash-event', { preHandler: requirePermission('pos.sell') }, async (req) => {
    const body = parse(z.object({ type: z.enum(['PAID_IN', 'PAID_OUT', 'NO_SALE']), amount: z.number().int().min(0).default(0), reason: z.string().min(2) }), req.body);
    const shift = await loadShift(req, req.params.id);
    if (shift.status !== 'OPEN') throw conflict('Shift is closed');
    if (body.type === 'PAID_OUT' && !hasPermission(req, 'pos.shift.manage') && body.amount > 5000) throw forbidden('Paid-outs over $50 need a manager');
    return tx(async (db) => {
      const e = await db.cashEvent.create({ data: { ...body, amount: body.type === 'NO_SALE' ? 0 : body.amount, shiftId: shift.id, userId: req.ctx.userId } });
      await audit(db, actorFrom(req), { module: 'POS', action: `cash.${body.type.toLowerCase()}`, entityType: 'Shift', entityId: shift.id, summary: `${body.type.replace('_', ' ')} ${body.amount ? (body.amount / 100).toFixed(2) : ''} — ${body.reason}` });
      return e;
    });
  });
}

function expectedFor(openingFloat: number, s: Awaited<ReturnType<typeof summariseShifts>>) {
  return expectedCash({ openingFloat, cashSales: s.cashSales, cashRefunds: s.cashRefunds, paidIn: s.paidIn + s.otherCashIn, paidOut: s.paidOut });
}
