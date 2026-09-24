import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, audit } from '../../../core/audit';
import { requirePermission, tenantOf } from '../../../core/auth';
import { prisma, tx } from '../../../core/db';
import { parse } from '../../../core/errors';

export async function customersRoutes(app: FastifyInstance) {
  app.get('/customers', { preHandler: requirePermission('pos.sell') }, async (req) => {
    const tenantId = tenantOf(req);
    const { q } = parse(z.object({ q: z.string().optional() }), req.query);
    return prisma.customer.findMany({
      where: { tenantId, ...(q ? { OR: [{ name: { contains: q } }, { phone: { contains: q } }, { loyaltyNo: { contains: q } }, { email: { contains: q } }] } : {}) },
      orderBy: { name: 'asc' },
      take: 25,
    });
  });

  app.post('/customers', { preHandler: requirePermission('pos.sell') }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(z.object({ name: z.string().min(2), email: z.email().optional().or(z.literal('')), phone: z.string().optional(), loyaltyNo: z.string().optional() }), req.body);
    return tx(async (db) => {
      const c = await db.customer.create({ data: { tenantId, name: body.name, email: body.email || null, phone: body.phone, loyaltyNo: body.loyaltyNo || `SL${Date.now().toString().slice(-8)}` } });
      await audit(db, actorFrom(req), { module: 'POS', action: 'customer.create', entityType: 'Customer', entityId: c.id, summary: `Customer ${c.name} enrolled` });
      return c;
    });
  });
}
