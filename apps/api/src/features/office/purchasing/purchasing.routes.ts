import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorFrom, audit } from '../../../core/audit';
import { requirePermission, storeOf, tenantOf } from '../../../core/auth';
import { prisma, tx } from '../../../core/db';
import { badRequest, conflict, notFound, parse, unprocessable } from '../../../core/errors';
import { moveStock } from '../../../core/inventory';
import { effectiveCost, nextNumber } from '../../../core/store-config';

export async function purchasingRoutes(app: FastifyInstance) {
  app.get('/orders', { preHandler: requirePermission('office.products.read') }, async (req) => {
    const storeId = storeOf(req);
    const { status } = parse(z.object({ status: z.string().optional() }), req.query);
    const orders = await prisma.purchaseOrder.findMany({
      where: { storeId, status: status ? { in: status.split(',') } : undefined },
      include: { supplier: { select: { name: true, electronic: true } }, lines: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return orders.map(({ lines, ...o }) => ({ ...o, lineCount: lines.length, total: lines.reduce((s, l) => s + l.qtyOrdered * l.unitCost, 0), received: lines.reduce((s, l) => s + l.qtyReceived, 0), ordered: lines.reduce((s, l) => s + l.qtyOrdered, 0) }));
  });

  app.post('/orders', { preHandler: requirePermission('office.purchasing.write') }, async (req) => {
    const tenantId = tenantOf(req);
    const storeId = storeOf(req);
    const body = parse(
      z.object({ supplierId: z.string(), source: z.enum(['MANUAL', 'REORDER', 'TEMPLATE']).default('MANUAL'), notes: z.string().optional(), lines: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive(), unitCost: z.number().int().min(0).optional() })).min(1) }),
      req.body,
    );
    const supplier = await prisma.supplier.findFirst({ where: { id: body.supplierId, tenantId } });
    if (!supplier) throw notFound('Supplier');
    const products = await prisma.product.findMany({ where: { tenantId, id: { in: body.lines.map((l) => l.productId) } }, include: { suppliers: { where: { supplierId: supplier.id } } } });
    if (products.length !== new Set(body.lines.map((l) => l.productId)).size) throw badRequest('Unknown product on order');
    return tx(async (db) => {
      const number = await nextNumber(() => db.purchaseOrder.count({ where: { storeId } }), 'PO', 6);
      const order = await db.purchaseOrder.create({
        data: {
          storeId, number, supplierId: supplier.id, source: body.source, notes: body.notes, createdById: req.ctx.userId,
          lines: {
            create: body.lines.map((l) => {
              const p = products.find((x) => x.id === l.productId)!;
              return { productId: l.productId, qtyOrdered: l.quantity, unitCost: l.unitCost ?? p.suppliers[0]?.cost ?? p.costPrice };
            }),
          },
        },
        include: { lines: true },
      });
      await audit(db, actorFrom(req), { module: 'OFFICE', action: 'order.create', entityType: 'PurchaseOrder', entityId: order.id, summary: `Purchase order ${number} drafted for ${supplier.name} (${order.lines.length} lines)` });
      return order;
    });
  });

  app.get<{ Params: { id: string } }>('/orders/:id', { preHandler: requirePermission('office.products.read') }, async (req) => {
    const order = await loadOrder(req, req.params.id);
    const products = await prisma.product.findMany({ where: { id: { in: order.lines.map((l) => l.productId) } }, select: { id: true, name: true, sku: true, barcode: true } });
    return { ...order, lines: order.lines.map((l) => ({ ...l, product: products.find((p) => p.id === l.productId) ?? null })) };
  });

  app.post<{ Params: { id: string } }>('/orders/:id/submit', { preHandler: requirePermission('office.purchasing.write') }, async (req) => {
    const order = await loadOrder(req, req.params.id);
    if (order.status !== 'DRAFT') throw conflict('Only draft orders can be submitted');
    return tx(async (db) => {
      const updated = await db.purchaseOrder.update({ where: { id: order.id }, data: { status: 'SUBMITTED', submittedAt: new Date(), expectedAt: new Date(Date.now() + (order.supplier.electronic ? 1 : 3) * 86_400_000) } });
      await audit(db, actorFrom(req), {
        module: 'OFFICE', action: 'order.submit', entityType: 'PurchaseOrder', entityId: order.id,
        summary: `Purchase order ${order.number} submitted to ${order.supplier.name} ${order.supplier.electronic ? 'electronically via supplier gateway' : 'manually (email/phone)'}`,
      });
      return updated;
    });
  });

  app.post<{ Params: { id: string } }>('/orders/:id/cancel', { preHandler: requirePermission('office.purchasing.write') }, async (req) => {
    const order = await loadOrder(req, req.params.id);
    if (!['DRAFT', 'SUBMITTED'].includes(order.status)) throw conflict('Orders with received goods cannot be cancelled');
    return tx(async (db) => {
      const updated = await db.purchaseOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
      await audit(db, actorFrom(req), { module: 'OFFICE', action: 'order.cancel', entityType: 'PurchaseOrder', entityId: order.id, summary: `Purchase order ${order.number} cancelled` });
      return updated;
    });
  });

  /**
   * Goods receiving is a distinct step from ordering: delivered quantities and invoice costs
   * are recorded as they arrive, stock is increased, and cost changes flow to price history.
   */
  app.post<{ Params: { id: string } }>('/orders/:id/receive', { preHandler: requirePermission('office.purchasing.write') }, async (req) => {
    const storeId = storeOf(req);
    const body = parse(
      z.object({ invoiceNo: z.string().min(1, 'Supplier invoice number is required'), lines: z.array(z.object({ lineId: z.string(), quantity: z.number().int().min(0), unitCost: z.number().int().min(0) })).min(1) }),
      req.body,
    );
    const order = await loadOrder(req, req.params.id);
    if (!['SUBMITTED', 'PARTIALLY_RECEIVED'].includes(order.status)) throw conflict('Only submitted orders can be received');
    const receiving = body.lines.filter((l) => l.quantity > 0);
    if (receiving.length === 0) throw unprocessable('Enter at least one received quantity');

    return tx(async (db) => {
      const receipt = await db.goodsReceipt.create({ data: { orderId: order.id, invoiceNo: body.invoiceNo, receivedById: req.ctx.userId } });
      const costChanges: string[] = [];
      for (const r of receiving) {
        const line = order.lines.find((l) => l.id === r.lineId);
        if (!line) throw badRequest('Line does not belong to this order');
        await db.goodsReceiptLine.create({ data: { receiptId: receipt.id, productId: line.productId, quantity: r.quantity, unitCost: r.unitCost } });
        await db.purchaseOrderLine.update({ where: { id: line.id }, data: { qtyReceived: { increment: r.quantity } } });
        await moveStock(db, { storeId, productId: line.productId, quantity: r.quantity, reason: 'RECEIPT', refType: 'GoodsReceipt', refId: receipt.id, userId: req.ctx.userId, note: `${order.number} / inv ${body.invoiceNo}` });
        const sp = await db.storeProduct.findUnique({ where: { storeId_productId: { storeId, productId: line.productId } }, include: { product: true } });
        const currentCost = sp ? effectiveCost(sp.product, sp) : line.unitCost;
        if (sp && r.unitCost !== currentCost) {
          await db.storeProduct.update({ where: { storeId_productId: { storeId, productId: line.productId } }, data: { costPrice: r.unitCost } });
          await db.priceHistory.create({ data: { productId: line.productId, storeId, oldCost: currentCost, newCost: r.unitCost, source: 'RECEIVING', refId: receipt.id, userId: req.ctx.userId } });
          costChanges.push(`${sp.product.name}: ${(currentCost / 100).toFixed(2)} → ${(r.unitCost / 100).toFixed(2)}`);
        }
      }
      const lines = await db.purchaseOrderLine.findMany({ where: { orderId: order.id } });
      const complete = lines.every((l) => l.qtyReceived >= l.qtyOrdered);
      const updated = await db.purchaseOrder.update({ where: { id: order.id }, data: { status: complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED' } });
      await audit(db, actorFrom(req), {
        module: 'OFFICE', action: 'order.receive', entityType: 'PurchaseOrder', entityId: order.id,
        summary: `Received ${receiving.reduce((s, l) => s + l.quantity, 0)} units on ${order.number} (invoice ${body.invoiceNo})${costChanges.length ? `; cost changes: ${costChanges.join('; ')}` : ''}`,
      });
      return { order: updated, receipt, costChanges };
    });
  });
}

async function loadOrder(req: FastifyRequest, id: string) {
  const order = await prisma.purchaseOrder.findFirst({ where: { id, storeId: storeOf(req) }, include: { supplier: true, lines: true, receipts: { include: { lines: true } } } });
  if (!order) throw notFound('Purchase order');
  return order;
}
