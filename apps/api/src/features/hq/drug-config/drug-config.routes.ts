import { DRUG_FLAGS, RANKING_BASES } from '@segue/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, audit } from '../../../core/audit';
import { requirePermission, tenantOf } from '../../../core/auth';
import { prisma, tx } from '../../../core/db';
import { badRequest, notFound, parse } from '../../../core/errors';
import { futureDate } from '../shared/hq.shared';
import { createPublication } from '../sync/publication.service';

export async function drugConfigRoutes(app: FastifyInstance) {
  app.get('/drug-config', { preHandler: requirePermission('hq.config.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const q = parse(z.object({ groupId: z.string(), q: z.string().optional() }), req.query);
    const [drugs, flags, strategy] = await Promise.all([
      prisma.drug.findMany({ where: { tenantId, ...(q.q ? { OR: [{ genericName: { contains: q.q } }, { brandName: { contains: q.q } }] } : {}) }, include: { products: { select: { costPrice: true, retailPrice: true } } }, orderBy: [{ genericName: 'asc' }, { strength: 'asc' }, { brandName: 'asc' }] }),
      prisma.drugGroupFlag.findMany({ where: { groupId: q.groupId } }),
      prisma.rankingStrategy.findUnique({ where: { groupId: q.groupId } }),
    ]);
    return {
      basis: strategy?.basis ?? null,
      drugs: drugs.map((d) => ({
        id: d.id, genericName: d.genericName, brandName: d.brandName, strength: d.strength, form: d.form, drugClass: d.drugClass, schedule: d.schedule, pbsCode: d.pbsCode,
        cost: d.products[0]?.costPrice ?? null, flag: flags.find((f) => f.drugId === d.id)?.flag ?? null,
      })),
    };
  });

  app.post('/drug-config/publish', { preHandler: requirePermission('hq.drugconfig.write') }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(z.object({ groupId: z.string(), basis: z.enum(RANKING_BASES).nullable().optional(), flags: z.array(z.object({ drugId: z.string(), flag: z.enum(DRUG_FLAGS).nullable() })).default([]), effectiveAt: futureDate }), req.body);
    if (!body.basis && body.flags.length === 0) throw badRequest('Nothing to publish');
    const group = await prisma.storeGroup.findFirst({ where: { id: body.groupId, tenantId }, include: { members: { include: { store: true } } } });
    if (!group) throw notFound('Store group');
    if (body.flags.length) {
      const count = await prisma.drug.count({ where: { tenantId, id: { in: body.flags.map((f) => f.drugId) } } });
      if (count !== body.flags.length) throw badRequest('Unknown drug in flags');
    }
    return tx(async (db) => {
      const pub = await createPublication(db, {
        tenantId, kind: 'DRUG_CONFIG', title: `Drug configuration: ${group.name}${body.basis ? ` (${body.basis.replace(/_/g, ' ').toLowerCase()})` : ''}${body.flags.length ? `, ${body.flags.length} flag change(s)` : ''}`,
        payload: { groupId: group.id, basis: body.basis ?? null, flags: body.flags }, storeIds: group.members.filter((m) => m.store.status === 'ACTIVE').map((m) => m.storeId), effectiveAt: body.effectiveAt, createdById: req.ctx.userId,
      });
      await audit(db, actorFrom(req), { module: 'HQ', action: 'drugconfig.publish', entityType: 'Publication', entityId: pub.id, storeId: null, summary: pub.title, after: body });
      return pub;
    });
  });
}
