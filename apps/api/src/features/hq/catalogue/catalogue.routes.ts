import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission, tenantOf } from '../../../core/auth';
import { prisma } from '../../../core/db';
import { parse } from '../../../core/errors';
import { effectiveCost } from '../../../core/store-config';

export async function catalogueRoutes(app: FastifyInstance) {
  // Product picker used by promotions and retail pricing screens.
  app.get('/catalogue', { preHandler: requirePermission('hq.config.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const { q } = parse(z.object({ q: z.string().optional() }), req.query);
    const products = await prisma.product.findMany({ where: { tenantId, isActive: true, department: 'FRONT_SHOP', ...(q ? { OR: [{ name: { contains: q } }, { sku: { contains: q.toUpperCase() } }] } : {}) }, take: 50, orderBy: { name: 'asc' } });
    return products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, category: p.category, retailPrice: p.retailPrice, costPrice: effectiveCost(p, null) }));
  });
}
