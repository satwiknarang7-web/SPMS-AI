import { PROMOTION_TYPES } from '@segue/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, audit } from '../../../core/audit';
import { requirePermission, tenantOf } from '../../../core/auth';
import { json, prisma, tx } from '../../../core/db';
import { badRequest, conflict, notFound, parse } from '../../../core/errors';
import { createPublication } from '../sync/publication.service';

export async function promotionsRoutes(app: FastifyInstance) {
  app.get('/promotions', { preHandler: requirePermission('hq.config.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const promos = await prisma.promotion.findMany({ where: { tenantId }, orderBy: { startsAt: 'desc' } });
    const pubs = await prisma.publication.findMany({ where: { id: { in: promos.map((p) => p.publicationId).filter((x): x is string => !!x) } }, include: { targets: { select: { status: true } } } });
    const productIds = [...new Set(promos.flatMap((p) => json.parse<string[]>(p.productIds, [])))];
    const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } });
    return promos.map((p) => {
      const pub = pubs.find((x) => x.id === p.publicationId);
      const ids = json.parse<string[]>(p.productIds, []);
      return {
        ...p, productIds: ids, storeIds: json.parse<string[]>(p.storeIds, []), products: products.filter((x) => ids.includes(x.id)),
        delivery: pub ? { applied: pub.targets.filter((t) => t.status === 'APPLIED').length, total: pub.targets.length } : null,
      };
    });
  });

  app.post('/promotions', { preHandler: requirePermission('hq.promotions.write') }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(
      z.object({ name: z.string().min(3), type: z.enum(PROMOTION_TYPES), value: z.number().int().positive(), productIds: z.array(z.string()).min(1), storeIds: z.array(z.string()).min(1), startsAt: z.coerce.date(), endsAt: z.coerce.date() }),
      req.body,
    );
    if (body.endsAt <= body.startsAt) throw badRequest('End date must be after start date');
    if (body.type === 'PERCENT_OFF' && body.value >= 100) throw badRequest('Percentage must be below 100');
    const [pc, sc] = await Promise.all([prisma.product.count({ where: { tenantId, id: { in: body.productIds } } }), prisma.store.count({ where: { tenantId, id: { in: body.storeIds } } })]);
    if (pc !== body.productIds.length || sc !== body.storeIds.length) throw badRequest('Unknown product or store');
    return tx(async (db) => {
      const promo = await db.promotion.create({ data: { ...body, tenantId, productIds: json.stringify(body.productIds), storeIds: json.stringify(body.storeIds) } });
      await audit(db, actorFrom(req), { module: 'HQ', action: 'promotion.create', entityType: 'Promotion', entityId: promo.id, storeId: null, summary: `Promotion "${promo.name}" drafted`, after: body });
      return promo;
    });
  });

  app.post<{ Params: { id: string } }>('/promotions/:id/publish', { preHandler: requirePermission('hq.promotions.write', 'hq.publish') }, async (req) => {
    const tenantId = tenantOf(req);
    const promo = await prisma.promotion.findFirst({ where: { id: req.params.id, tenantId } });
    if (!promo) throw notFound('Promotion');
    if (promo.status !== 'DRAFT' || promo.publicationId) throw conflict('Promotion has already been published');
    if (promo.endsAt < new Date()) throw conflict('Promotion has already ended');
    return tx(async (db) => {
      const pub = await createPublication(db, { tenantId, kind: 'PROMOTION', title: `Promotion: ${promo.name}`, payload: { promotionId: promo.id }, storeIds: json.parse<string[]>(promo.storeIds, []), createdById: req.ctx.userId });
      await db.promotion.update({ where: { id: promo.id }, data: { publicationId: pub.id } });
      await audit(db, actorFrom(req), { module: 'HQ', action: 'promotion.publish', entityType: 'Promotion', entityId: promo.id, storeId: null, summary: `Promotion "${promo.name}" published`, before: { status: 'DRAFT' }, after: { publicationId: pub.id } });
      return pub;
    });
  });
}
