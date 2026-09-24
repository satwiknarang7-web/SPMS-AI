import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, audit } from '../../../core/audit';
import { requirePermission, tenantOf } from '../../../core/auth';
import { json, prisma, tx } from '../../../core/db';
import { notFound, parse } from '../../../core/errors';
import { buildReport, isReportTemplate, nextRun, REPORT_TEMPLATES, reportToCsv, runDueReportSchedules, type ReportFilters } from './reports.service';

const reportQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  storeIds: z.string().optional().transform((s) => (s ? s.split(',').filter(Boolean) : undefined)),
  groupId: z.string().optional(),
  category: z.string().optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

export async function reportsRoutes(app: FastifyInstance) {
  app.get('/reports/templates', { preHandler: requirePermission('hq.reports.read') }, async () => Object.entries(REPORT_TEMPLATES).map(([key, v]) => ({ key, ...v })));

  app.get<{ Params: { template: string } }>('/reports/run/:template', { preHandler: requirePermission('hq.reports.read') }, async (req, reply) => {
    const tenantId = tenantOf(req);
    if (!isReportTemplate(req.params.template)) throw notFound('Report template');
    const { format, ...filters } = parse(reportQuery, req.query);
    const report = await buildReport(tenantId, req.params.template, filters);
    if (format === 'csv') {
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${req.params.template}-${report.from}-to-${report.to}.csv"`)
        .send(reportToCsv(report));
    }
    return report;
  });

  app.get('/reports/schedules', { preHandler: requirePermission('hq.reports.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const schedules = await prisma.reportSchedule.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    return schedules.map((s) => ({ ...s, filters: json.parse<ReportFilters>(s.filters, {}) }));
  });

  app.post('/reports/schedules', { preHandler: requirePermission('hq.reports.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(
      z.object({
        template: z.string().refine(isReportTemplate, 'Unknown report template'),
        cadence: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
        recipients: z.array(z.email()).min(1).max(20),
        filters: z.object({ storeIds: z.array(z.string()).optional(), groupId: z.string().optional(), category: z.string().optional() }).default({}),
      }),
      req.body,
    );
    return tx(async (db) => {
      const s = await db.reportSchedule.create({ data: { tenantId, template: body.template, cadence: body.cadence, recipients: body.recipients.join(','), filters: json.stringify(body.filters), nextRunAt: nextRun(body.cadence), createdById: req.ctx.userId } });
      await audit(db, actorFrom(req), { module: 'HQ', action: 'report.schedule', entityType: 'ReportSchedule', entityId: s.id, storeId: null, summary: `Scheduled ${body.cadence.toLowerCase()} "${body.template}" report to ${body.recipients.join(', ')}` });
      return s;
    });
  });

  app.delete<{ Params: { id: string } }>('/reports/schedules/:id', { preHandler: requirePermission('hq.reports.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const s = await prisma.reportSchedule.findFirst({ where: { id: req.params.id, tenantId } });
    if (!s) throw notFound('Schedule');
    await tx(async (db) => {
      await db.reportSchedule.delete({ where: { id: s.id } });
      await audit(db, actorFrom(req), { module: 'HQ', action: 'report.unschedule', entityType: 'ReportSchedule', entityId: s.id, storeId: null, summary: `Removed scheduled "${s.template}" report` });
    });
    return { deleted: true };
  });

  /** Development email outbox — shows what the scheduled-report adapter would send. */
  app.get('/reports/outbox', { preHandler: requirePermission('hq.reports.read') }, async (req) =>
    prisma.emailOutbox.findMany({ where: { tenantId: tenantOf(req) }, select: { id: true, to: true, subject: true, attachmentName: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 20 }),
  );

  app.post<{ Params: { id: string } }>('/reports/schedules/:id/run', { preHandler: requirePermission('hq.reports.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const s = await prisma.reportSchedule.findFirst({ where: { id: req.params.id, tenantId } });
    if (!s) throw notFound('Schedule');
    await prisma.reportSchedule.update({ where: { id: s.id }, data: { nextRunAt: new Date() } });
    await runDueReportSchedules();
    return { sent: true };
  });
}
