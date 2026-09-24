import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, audit } from '../../../core/audit';
import { requirePermission, storeOf } from '../../../core/auth';
import { prisma, tx } from '../../../core/db';
import { conflict, notFound, parse } from '../../../core/errors';
import { nextNumber } from '../../../core/store-config';
import { loadShift } from '../shared/pos.shared';

export async function hireRoutes(app: FastifyInstance) {
  app.get('/hire/items', { preHandler: requirePermission('pos.hire') }, async (req) =>
    prisma.hireItem.findMany({ where: { storeId: storeOf(req) }, orderBy: [{ group: 'asc' }, { name: 'asc' }] }),
  );

  app.get('/hire/contracts', { preHandler: requirePermission('pos.hire') }, async (req) => {
    const storeId = storeOf(req);
    const contracts = await prisma.hireContract.findMany({ where: { storeId }, include: { item: true }, orderBy: { startDate: 'desc' }, take: 100 });
    const customers = await prisma.customer.findMany({ where: { id: { in: contracts.map((c) => c.customerId) } }, select: { id: true, name: true, phone: true } });
    return contracts.map((c) => ({ ...c, customer: customers.find((x) => x.id === c.customerId) ?? null }));
  });

  app.post('/hire/contracts', { preHandler: requirePermission('pos.hire') }, async (req) => {
    const storeId = storeOf(req);
    const body = parse(z.object({ shiftId: z.string(), hireItemId: z.string(), customerId: z.string(), weeks: z.number().int().min(1).max(52), notes: z.string().optional() }), req.body);
    const shift = await loadShift(req, body.shiftId);
    if (shift.status !== 'OPEN') throw conflict('Open a shift first');
    return tx(async (db) => {
      const item = await db.hireItem.findFirst({ where: { id: body.hireItemId, storeId } });
      if (!item) throw notFound('Hire item');
      if (item.status !== 'AVAILABLE') throw conflict(`${item.name} is not available (${item.status})`);
      const number = await nextNumber(() => db.hireContract.count({ where: { storeId } }), 'HC', 5);
      const contract = await db.hireContract.create({
        data: { storeId, number, hireItemId: item.id, customerId: body.customerId, dueDate: new Date(Date.now() + body.weeks * 7 * 86_400_000), depositPaid: item.deposit, notes: body.notes },
      });
      await db.hireItem.update({ where: { id: item.id }, data: { status: 'ON_HIRE' } });
      await db.cashEvent.create({ data: { shiftId: shift.id, type: 'HIRE', amount: item.deposit, reason: `Hire ${number} security deposit`, userId: req.ctx.userId } });
      await audit(db, actorFrom(req), { module: 'POS', action: 'hire.create', entityType: 'HireContract', entityId: contract.id, summary: `Hire ${number}: ${item.name} (${item.serial}) for ${body.weeks} week(s)` });
      return contract;
    });
  });

  app.post<{ Params: { id: string } }>('/hire/contracts/:id/return', { preHandler: requirePermission('pos.hire') }, async (req) => {
    const storeId = storeOf(req);
    const body = parse(z.object({ shiftId: z.string(), condition: z.enum(['GOOD', 'NEEDS_SERVICE']), notes: z.string().optional() }), req.body);
    const shift = await loadShift(req, body.shiftId);
    if (shift.status !== 'OPEN') throw conflict('Open a shift first');
    return tx(async (db) => {
      const contract = await db.hireContract.findFirst({ where: { id: req.params.id, storeId }, include: { item: true } });
      if (!contract) throw notFound('Hire contract');
      if (contract.status !== 'ACTIVE') throw conflict('Contract already returned');
      const weeks = Math.max(1, Math.ceil((Date.now() - contract.startDate.getTime()) / (7 * 86_400_000)));
      const hireCharge = weeks * contract.item.weeklyRate;
      const refund = Math.max(0, contract.depositPaid - hireCharge);
      const balanceOwing = Math.max(0, hireCharge - contract.depositPaid);
      const updated = await db.hireContract.update({
        where: { id: contract.id },
        data: { status: 'RETURNED', returnedAt: new Date(), hireCharge, depositRefunded: refund, notes: [contract.notes, body.notes].filter(Boolean).join(' · ') || null },
      });
      await db.hireItem.update({ where: { id: contract.hireItemId }, data: { status: body.condition === 'GOOD' ? 'AVAILABLE' : 'MAINTENANCE' } });
      if (refund) await db.cashEvent.create({ data: { shiftId: shift.id, type: 'HIRE', amount: -refund, reason: `Hire ${contract.number} deposit refund`, userId: req.ctx.userId } });
      if (balanceOwing) await db.cashEvent.create({ data: { shiftId: shift.id, type: 'HIRE', amount: balanceOwing, reason: `Hire ${contract.number} balance`, userId: req.ctx.userId } });
      await audit(db, actorFrom(req), { module: 'POS', action: 'hire.return', entityType: 'HireContract', entityId: contract.id, summary: `Hire ${contract.number} returned after ${weeks} week(s): charge ${(hireCharge / 100).toFixed(2)}, deposit refund ${(refund / 100).toFixed(2)}` });
      return { ...updated, weeks, balanceOwing };
    });
  });
}
