import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, audit } from '../../../core/audit';
import { requirePermission, tenantOf } from '../../../core/auth';
import { prisma, tx } from '../../../core/db';
import { notFound, parse } from '../../../core/errors';

export async function accountsRoutes(app: FastifyInstance) {
  app.get('/accounts', { preHandler: requirePermission('office.products.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const { q } = parse(z.object({ q: z.string().optional() }), req.query);
    return prisma.customer.findMany({
      where: { tenantId, hasAccount: true, ...(q ? { OR: [{ name: { contains: q } }, { phone: { contains: q } }] } : {}) },
      include: { patient: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { name: 'asc' },
    });
  });

  app.post('/accounts', { preHandler: requirePermission('office.accounts.write') }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(
      z.object({ customerId: z.string().optional(), name: z.string().min(2), email: z.email().optional().or(z.literal('')), phone: z.string().optional(), creditLimit: z.number().int().min(0), accountFee: z.number().int().min(0).default(0), patientId: z.string().optional().nullable() }),
      req.body,
    );
    if (body.patientId && !(await prisma.patient.findFirst({ where: { id: body.patientId, tenantId } }))) throw notFound('Patient');
    return tx(async (db) => {
      const data = { name: body.name, email: body.email || null, phone: body.phone, creditLimit: body.creditLimit, accountFee: body.accountFee, patientId: body.patientId || null, hasAccount: true };
      const c = body.customerId
        ? await db.customer.update({ where: { id: body.customerId }, data })
        : await db.customer.create({ data: { ...data, tenantId } });
      await audit(db, actorFrom(req), { module: 'OFFICE', action: 'account.open', entityType: 'Customer', entityId: c.id, summary: `Account opened for ${c.name} (limit ${(c.creditLimit / 100).toFixed(2)})` });
      return c;
    });
  });

  app.get<{ Params: { id: string } }>('/accounts/:id', { preHandler: requirePermission('office.products.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const c = await prisma.customer.findFirst({
      where: { id: req.params.id, tenantId },
      include: { transactions: { orderBy: { createdAt: 'desc' }, take: 200 }, patient: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!c) throw notFound('Account');
    return c;
  });

  app.post<{ Params: { id: string } }>('/accounts/:id/transaction', { preHandler: requirePermission('office.accounts.write') }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(z.object({ type: z.enum(['PAYMENT', 'FEE', 'ADJUSTMENT']), amount: z.number().int().positive(), note: z.string().min(2), direction: z.enum(['CREDIT', 'DEBIT']).default('CREDIT') }), req.body);
    const c = await prisma.customer.findFirst({ where: { id: req.params.id, tenantId, hasAccount: true } });
    if (!c) throw notFound('Account');
    // PAYMENT reduces the balance owed, FEE increases it; ADJUSTMENT follows `direction`.
    const signed = body.type === 'PAYMENT' ? -body.amount : body.type === 'FEE' ? body.amount : body.direction === 'CREDIT' ? -body.amount : body.amount;
    return tx(async (db) => {
      const t = await db.accountTransaction.create({ data: { customerId: c.id, type: body.type, amount: signed, note: body.note, userId: req.ctx.userId } });
      const updated = await db.customer.update({ where: { id: c.id }, data: { balance: { increment: signed } } });
      await audit(db, actorFrom(req), { module: 'OFFICE', action: `account.${body.type.toLowerCase()}`, entityType: 'Customer', entityId: c.id, summary: `${body.type} ${(body.amount / 100).toFixed(2)} on ${c.name}'s account — ${body.note}`, before: { balance: c.balance }, after: { balance: updated.balance } });
      return { transaction: t, balance: updated.balance };
    });
  });

  /** Apply scheduled monthly account fees to every account that carries one. */
  app.post('/accounts/apply-fees', { preHandler: requirePermission('office.accounts.write') }, async (req) => {
    const tenantId = tenantOf(req);
    const accounts = await prisma.customer.findMany({ where: { tenantId, hasAccount: true, accountFee: { gt: 0 } } });
    return tx(async (db) => {
      for (const a of accounts) {
        await db.accountTransaction.create({ data: { customerId: a.id, type: 'FEE', amount: a.accountFee, note: 'Monthly account fee', userId: req.ctx.userId } });
        await db.customer.update({ where: { id: a.id }, data: { balance: { increment: a.accountFee } } });
      }
      await audit(db, actorFrom(req), { module: 'OFFICE', action: 'account.fees', entityType: 'Customer', summary: `Monthly fees applied to ${accounts.length} account(s)` });
      return { applied: accounts.length };
    });
  });
}
