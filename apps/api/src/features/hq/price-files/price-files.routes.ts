import { parsePriceCsv, validatePriceRows } from '@segue/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, audit } from '../../../core/audit';
import { requirePermission, tenantOf } from '../../../core/auth';
import { json, prisma, tx } from '../../../core/db';
import { conflict, notFound, parse, unprocessable } from '../../../core/errors';
import { futureDate } from '../shared/hq.shared';
import { createPublication } from '../sync/publication.service';

export async function priceFilesRoutes(app: FastifyInstance) {
  app.get('/pricefiles', { preHandler: requirePermission('hq.config.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const files = await prisma.priceFile.findMany({ where: { tenantId }, include: { supplier: { select: { name: true } } }, orderBy: { createdAt: 'desc' } });
    return files.map((f) => ({ ...f, summary: json.parse(f.summary, {}) }));
  });

  app.get('/suppliers', { preHandler: requirePermission('hq.config.read') }, async (req) => prisma.supplier.findMany({ where: { tenantId: tenantOf(req) }, orderBy: { name: 'asc' } }));

  app.post('/pricefiles', { preHandler: requirePermission('hq.pricefiles.write') }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(z.object({ supplierId: z.string(), fileName: z.string().min(1), content: z.string().min(1).max(2_000_000), outlierPct: z.number().min(1).max(100).default(20) }), req.body);
    const supplier = await prisma.supplier.findFirst({ where: { id: body.supplierId, tenantId } });
    if (!supplier) throw notFound('Supplier');
    const { rows, headerError } = parsePriceCsv(body.content);
    if (headerError) throw unprocessable(headerError);
    if (rows.length === 0) throw unprocessable('The file contains no price rows');
    const products = await prisma.product.findMany({ where: { tenantId }, include: { suppliers: { where: { supplierId: supplier.id } } } });
    const validated = validatePriceRows(rows, products.map((p) => ({ id: p.id, barcode: p.barcode, supplierCode: p.suppliers[0]?.supplierCode ?? null, cost: p.costPrice, retail: p.retailPrice })), body.outlierPct);
    const summary = validated.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.issue]: (acc[r.issue] ?? 0) + 1 }), {});
    return tx(async (db) => {
      const file = await db.priceFile.create({
        data: {
          tenantId, supplierId: supplier.id, fileName: body.fileName, uploadedById: req.ctx.userId, summary: json.stringify(summary),
          lines: { create: validated.map((r) => ({ ...r, accepted: r.issue === 'OK' })) },
        },
      });
      await audit(db, actorFrom(req), { module: 'HQ', action: 'pricefile.upload', entityType: 'PriceFile', entityId: file.id, storeId: null, summary: `Price file ${body.fileName} from ${supplier.name}: ${rows.length} rows (${Object.entries(summary).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ')})` });
      return { ...file, summary };
    });
  });

  app.get<{ Params: { id: string } }>('/pricefiles/:id', { preHandler: requirePermission('hq.config.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const file = await prisma.priceFile.findFirst({ where: { id: req.params.id, tenantId }, include: { supplier: true, lines: { orderBy: { rowNo: 'asc' } } } });
    if (!file) throw notFound('Price file');
    const products = await prisma.product.findMany({ where: { id: { in: file.lines.map((l) => l.productId).filter((x): x is string => !!x) } }, select: { id: true, name: true, sku: true } });
    return { ...file, summary: json.parse(file.summary, {}), lines: file.lines.map((l) => ({ ...l, product: products.find((p) => p.id === l.productId) ?? null })) };
  });

  app.patch<{ Params: { id: string; lineId: string } }>('/pricefiles/:id/lines/:lineId', { preHandler: requirePermission('hq.pricefiles.write') }, async (req) => {
    const tenantId = tenantOf(req);
    const { accepted } = parse(z.object({ accepted: z.boolean() }), req.body);
    const line = await prisma.priceFileLine.findFirst({ where: { id: req.params.lineId, priceFileId: req.params.id, priceFile: { tenantId, status: 'VALIDATED' } } });
    if (!line) throw notFound('Price file line');
    if (accepted && !['OK', 'OUTLIER'].includes(line.issue)) throw unprocessable('Rows with errors or no matching product cannot be accepted');
    return prisma.priceFileLine.update({ where: { id: line.id }, data: { accepted } });
  });

  app.post<{ Params: { id: string } }>('/pricefiles/:id/approve', { preHandler: requirePermission('hq.pricefiles.write', 'hq.publish') }, async (req) => {
    const tenantId = tenantOf(req);
    const { effectiveAt } = parse(z.object({ effectiveAt: futureDate }), req.body ?? {});
    const file = await prisma.priceFile.findFirst({ where: { id: req.params.id, tenantId }, include: { lines: true, supplier: true } });
    if (!file) throw notFound('Price file');
    if (file.status !== 'VALIDATED') throw conflict(`Price file is ${file.status.toLowerCase()}`);
    const accepted = file.lines.filter((l) => l.accepted && l.productId && l.newCost != null && l.newRetail != null);
    if (accepted.length === 0) throw unprocessable('No accepted rows to publish');
    const stores = await prisma.store.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { id: true } });
    return tx(async (db) => {
      const pub = await createPublication(db, {
        tenantId, kind: 'PRICE_FILE', title: `Price file: ${file.supplier.name} — ${file.fileName} (${accepted.length} items)`,
        payload: { priceFileId: file.id, changes: accepted.map((l) => ({ productId: l.productId!, cost: l.newCost!, retail: l.newRetail! })) },
        storeIds: stores.map((s) => s.id), effectiveAt, createdById: req.ctx.userId,
      });
      await db.priceFile.update({ where: { id: file.id }, data: { status: 'APPROVED', approvedById: req.ctx.userId, publicationId: pub.id } });
      await audit(db, actorFrom(req), { module: 'HQ', action: 'pricefile.approve', entityType: 'PriceFile', entityId: file.id, storeId: null, summary: `Price file ${file.fileName} approved — ${accepted.length} price(s) published to ${stores.length} store(s)`, before: { status: 'VALIDATED' }, after: { status: 'APPROVED' } });
      return pub;
    });
  });

  app.post<{ Params: { id: string } }>('/pricefiles/:id/reject', { preHandler: requirePermission('hq.pricefiles.write') }, async (req) => {
    const tenantId = tenantOf(req);
    const { reason } = parse(z.object({ reason: z.string().min(3) }), req.body);
    const file = await prisma.priceFile.findFirst({ where: { id: req.params.id, tenantId } });
    if (!file) throw notFound('Price file');
    if (file.status !== 'VALIDATED') throw conflict('Only files awaiting approval can be rejected');
    return tx(async (db) => {
      const updated = await db.priceFile.update({ where: { id: file.id }, data: { status: 'REJECTED' } });
      await audit(db, actorFrom(req), { module: 'HQ', action: 'pricefile.reject', entityType: 'PriceFile', entityId: file.id, storeId: null, summary: `Price file ${file.fileName} rejected: ${reason}` });
      return updated;
    });
  });
}
