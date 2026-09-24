import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, audit } from '../../../core/audit';
import { requirePermission, tenantOf } from '../../../core/auth';
import { prisma, tx } from '../../../core/db';
import { notFound, parse } from '../../../core/errors';

const supplierBody = z.object({
  name: z.string().min(2),
  accountNo: z.string().optional().nullable(),
  contactName: z.string().optional().nullable(),
  email: z.email().optional().nullable().or(z.literal('')),
  phone: z.string().optional().nullable(),
  electronic: z.boolean(),
  terms: z.string().optional().nullable(),
});

export async function suppliersRoutes(app: FastifyInstance) {
  app.get('/suppliers', { preHandler: requirePermission('office.products.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const suppliers = await prisma.supplier.findMany({ where: { tenantId }, include: { _count: { select: { products: true, orders: true } } }, orderBy: { name: 'asc' } });
    return suppliers;
  });

  app.post('/suppliers', { preHandler: requirePermission('office.suppliers.write') }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(supplierBody, req.body);
    return tx(async (db) => {
      const s = await db.supplier.create({ data: { ...body, email: body.email || null, tenantId } });
      await audit(db, actorFrom(req), { module: 'OFFICE', action: 'supplier.create', entityType: 'Supplier', entityId: s.id, summary: `Supplier ${s.name} added` });
      return s;
    });
  });

  app.patch<{ Params: { id: string } }>('/suppliers/:id', { preHandler: requirePermission('office.suppliers.write') }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(supplierBody.partial(), req.body);
    const existing = await prisma.supplier.findFirst({ where: { id: req.params.id, tenantId } });
    if (!existing) throw notFound('Supplier');
    return tx(async (db) => {
      const s = await db.supplier.update({ where: { id: existing.id }, data: { ...body, email: body.email === undefined ? undefined : body.email || null } });
      await audit(db, actorFrom(req), { module: 'OFFICE', action: 'supplier.update', entityType: 'Supplier', entityId: s.id, summary: `Supplier ${s.name} updated`, after: body });
      return s;
    });
  });
}
