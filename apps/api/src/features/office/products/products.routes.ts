import { marginPct } from '@segue/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, audit } from '../../../core/audit';
import { requirePermission, storeOf, tenantOf } from '../../../core/auth';
import { prisma, tx } from '../../../core/db';
import { conflict, notFound, parse } from '../../../core/errors';
import { effectiveCost, effectiveRetail } from '../../../core/store-config';

const productBody = z.object({
  sku: z.string().min(2).transform((s) => s.toUpperCase()),
  barcode: z.string().regex(/^\d{8,14}$/, 'Barcode must be 8–14 digits').optional().nullable().or(z.literal('')),
  name: z.string().min(2),
  brand: z.string().optional().nullable(),
  category: z.string().min(2),
  department: z.enum(['DISPENSARY', 'FRONT_SHOP']),
  costPrice: z.number().int().min(0),
  retailPrice: z.number().int().positive('Selling price must be greater than zero'),
  gstFree: z.boolean().default(false),
  hotkeyColor: z.string().optional().nullable(),
  reorderPoint: z.number().int().min(0).default(0),
  reorderQty: z.number().int().min(0).default(0),
  primarySupplierId: z.string().optional().nullable(),
  supplierCode: z.string().optional().nullable(),
});

const productPatch = z.object({
  name: z.string().min(2),
  brand: z.string().nullable(),
  barcode: z.string().regex(/^\d{8,14}$/).nullable().or(z.literal('')),
  category: z.string().min(2),
  gstFree: z.boolean(),
  hotkeyColor: z.string().nullable(),
  isActive: z.boolean(),
  reorderPoint: z.number().int().min(0),
  reorderQty: z.number().int().min(0),
}).partial();

/** Query-string boolean: z.coerce.boolean would treat "false" as true. */
const queryBool = z.enum(['true', 'false']).transform((v) => v === 'true').optional();

export async function productsRoutes(app: FastifyInstance) {
  app.get('/products', { preHandler: requirePermission('office.products.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const storeId = storeOf(req);
    const q = parse(
      z.object({ q: z.string().optional(), category: z.string().optional(), department: z.string().optional(), lowStock: queryBool, inactive: queryBool, take: z.coerce.number().int().max(500).default(200) }),
      req.query,
    );
    const products = await prisma.product.findMany({
      where: {
        tenantId,
        isActive: q.inactive ? undefined : true,
        category: q.category,
        department: q.department,
        ...(q.q ? { OR: [{ name: { contains: q.q } }, { barcode: q.q }, { sku: { contains: q.q.toUpperCase() } }, { brand: { contains: q.q } }] } : {}),
      },
      include: { stores: { where: { storeId } }, suppliers: { where: { isPrimary: true }, include: { supplier: { select: { id: true, name: true } } } } },
      orderBy: { name: 'asc' },
      take: q.take,
    });
    const rows = products.map((p) => {
      const sp = p.stores[0];
      const retail = effectiveRetail(p, sp);
      const cost = effectiveCost(p, sp);
      return {
        id: p.id, sku: p.sku, barcode: p.barcode, name: p.name, brand: p.brand, category: p.category, department: p.department, isActive: p.isActive,
        gstFree: p.gstFree, hotkeyColor: p.hotkeyColor, drugId: p.drugId,
        retailPrice: retail, costPrice: cost, masterRetailPrice: p.retailPrice, marginPct: marginPct(retail, cost),
        onHand: sp?.onHand ?? 0, reorderPoint: sp?.reorderPoint ?? 0, reorderQty: sp?.reorderQty ?? 0,
        primarySupplier: p.suppliers[0]?.supplier ?? null,
      };
    });
    return q.lowStock ? rows.filter((r) => r.reorderPoint > 0 && r.onHand <= r.reorderPoint) : rows;
  });

  app.post('/products', { preHandler: requirePermission('office.products.write') }, async (req) => {
    const tenantId = tenantOf(req);
    const storeId = storeOf(req);
    const body = parse(productBody, req.body);
    if (body.barcode && (await prisma.product.findFirst({ where: { tenantId, barcode: body.barcode } }))) throw conflict('Another product already uses that barcode');
    if (await prisma.product.findFirst({ where: { tenantId, sku: body.sku } })) throw conflict('SKU already exists');
    return tx(async (db) => {
      const product = await db.product.create({
        data: {
          tenantId, sku: body.sku, barcode: body.barcode || null, name: body.name, brand: body.brand, category: body.category, department: body.department,
          costPrice: body.costPrice, retailPrice: body.retailPrice, gstFree: body.gstFree, hotkeyColor: body.hotkeyColor,
          stores: { create: { storeId, reorderPoint: body.reorderPoint, reorderQty: body.reorderQty } },
          ...(body.primarySupplierId ? { suppliers: { create: { supplierId: body.primarySupplierId, cost: body.costPrice, isPrimary: true, supplierCode: body.supplierCode } } } : {}),
        },
      });
      await db.priceHistory.create({ data: { productId: product.id, newCost: body.costPrice, newRetail: body.retailPrice, source: 'OFFICE_REVIEW', userId: req.ctx.userId } });
      await audit(db, actorFrom(req), { module: 'OFFICE', action: 'product.create', entityType: 'Product', entityId: product.id, summary: `Product ${product.name} (${product.sku}) created`, after: body });
      return product;
    });
  });

  app.get<{ Params: { id: string } }>('/products/:id', { preHandler: requirePermission('office.products.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const storeId = storeOf(req);
    const p = await prisma.product.findFirst({
      where: { id: req.params.id, tenantId },
      include: { stores: { where: { storeId } }, suppliers: { include: { supplier: true } }, drug: true },
    });
    if (!p) throw notFound('Product');
    const [movements, prices] = await Promise.all([
      prisma.stockMovement.findMany({ where: { storeId, productId: p.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.priceHistory.findMany({ where: { productId: p.id, OR: [{ storeId }, { storeId: null }] }, orderBy: { effectiveAt: 'desc' }, take: 30 }),
    ]);
    const sp = p.stores[0];
    return { ...p, storeProduct: sp ?? null, retailPrice: effectiveRetail(p, sp), costPrice: effectiveCost(p, sp), masterRetailPrice: p.retailPrice, masterCostPrice: p.costPrice, movements, prices };
  });

  app.patch<{ Params: { id: string } }>('/products/:id', { preHandler: requirePermission('office.products.write') }, async (req) => {
    const tenantId = tenantOf(req);
    const storeId = storeOf(req);
    const body = parse(productPatch, req.body);
    const existing = await prisma.product.findFirst({ where: { id: req.params.id, tenantId }, include: { stores: { where: { storeId } } } });
    if (!existing) throw notFound('Product');
    if (body.barcode && (await prisma.product.findFirst({ where: { tenantId, barcode: body.barcode, id: { not: existing.id } } }))) throw conflict('Another product already uses that barcode');
    return tx(async (db) => {
      const { reorderPoint, reorderQty, ...productFields } = body;
      const product = await db.product.update({ where: { id: existing.id }, data: { ...productFields, barcode: body.barcode === undefined ? undefined : body.barcode || null } });
      if (reorderPoint !== undefined || reorderQty !== undefined) {
        await db.storeProduct.upsert({
          where: { storeId_productId: { storeId, productId: existing.id } },
          create: { storeId, productId: existing.id, reorderPoint: reorderPoint ?? 0, reorderQty: reorderQty ?? 0 },
          update: { reorderPoint, reorderQty },
        });
      }
      await audit(db, actorFrom(req), { module: 'OFFICE', action: 'product.update', entityType: 'Product', entityId: product.id, summary: `Product ${product.name} updated`, after: body });
      return product;
    });
  });
}
