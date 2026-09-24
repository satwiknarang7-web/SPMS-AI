import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, audit } from '../../../core/audit';
import { requirePermission, tenantOf } from '../../../core/auth';
import { prisma, tx } from '../../../core/db';
import { parse } from '../../../core/errors';

export async function prescribersRoutes(app: FastifyInstance) {
  app.get('/prescribers', { preHandler: requirePermission('dispense.scripts.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const { q } = parse(z.object({ q: z.string().optional() }), req.query);
    return prisma.prescriber.findMany({
      where: { tenantId, ...(q ? { OR: [{ name: { contains: q } }, { prescriberNo: { contains: q } }, { practice: { contains: q } }] } : {}) },
      orderBy: { name: 'asc' },
      take: 30,
    });
  });

  app.post('/prescribers', { preHandler: requirePermission('dispense.prescribers.write') }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(
      z.object({ name: z.string().min(2), prescriberNo: z.string().regex(/^\d{6,7}[A-Z]?$/i, 'Prescriber number format is invalid'), type: z.string().default('GP'), practice: z.string().optional(), phone: z.string().optional() }),
      req.body,
    );
    return tx(async (db) => {
      const p = await db.prescriber.create({ data: { ...body, tenantId } });
      await audit(db, actorFrom(req), { module: 'DISPENSE', action: 'prescriber.create', entityType: 'Prescriber', entityId: p.id, summary: `Added prescriber ${p.name}` });
      return p;
    });
  });
}
