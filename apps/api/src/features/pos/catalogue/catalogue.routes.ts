import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission, storeOf, tenantOf } from '../../../core/auth';
import { prisma } from '../../../core/db';
import { notFound, parse } from '../../../core/errors';
import { effectiveRetail } from '../../../core/store-config';

export async function catalogueRoutes(app: FastifyInstance) {
  app.get('/lookup', { preHandler: requirePermission('pos.sell') }, async (req) => {
    const tenantId = tenantOf(req);
    const storeId = storeOf(req);
    const { code } = parse(z.object({ code: z.string().min(1) }), req.query);
    const c = code.trim();
    // A script token/number scanned at the till pulls the prescription straight into the cart.
    const script = await prisma.prescription.findFirst({ where: { storeId, OR: [{ number: c.toUpperCase() }, { erxToken: c.toUpperCase() }] } });
    if (script) return { kind: 'PRESCRIPTION', prescriptionId: script.id, status: script.status };
    const product = await prisma.product.findFirst({ where: { tenantId, isActive: true, OR: [{ barcode: c }, { sku: c.toUpperCase() }] } });
    if (!product) throw notFound(`Item "${c}"`);
    return { kind: 'PRODUCT', productId: product.id };
  });

  app.get('/hotkeys', { preHandler: requirePermission('pos.sell') }, async (req) => {
    const tenantId = tenantOf(req);
    const storeId = storeOf(req);
    const products = await prisma.product.findMany({
      where: { tenantId, isActive: true, hotkeyColor: { not: null } },
      include: { stores: { where: { storeId } } },
      orderBy: { name: 'asc' },
      take: 24,
    });
    return products.map((p) => ({ id: p.id, name: p.name, color: p.hotkeyColor, price: effectiveRetail(p, p.stores[0]) }));
  });

  app.get('/scripts/ready', { preHandler: requirePermission('pos.sell') }, async (req) => {
    const storeId = storeOf(req);
    const { q } = parse(z.object({ q: z.string().optional() }), req.query);
    return prisma.prescription.findMany({
      where: {
        storeId,
        status: 'READY',
        ...(q ? { OR: [{ number: { contains: q } }, { patient: { lastName: { contains: q } } }, { patient: { firstName: { contains: q } } }] } : {}),
      },
      include: { patient: { select: { id: true, firstName: true, lastName: true } }, drug: { select: { brandName: true, strength: true } } },
      orderBy: { dispensedAt: 'asc' },
      take: 50,
    });
  });
}
