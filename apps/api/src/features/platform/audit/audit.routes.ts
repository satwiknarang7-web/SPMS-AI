import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, verifyAuditChain } from '../../../core/audit';
import { requireAnyPermission, requirePermission, tenantOf } from '../../../core/auth';
import { prisma } from '../../../core/db';
import { forbidden, parse } from '../../../core/errors';

export async function auditRoutes(app: FastifyInstance) {
  app.get('/audit', { preHandler: requireAnyPermission('platform.audit.read', 'hq.config.read', 'dispense.scripts.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const q = parse(
      z.object({
        module: z.string().optional(),
        entityType: z.string().optional(),
        entityId: z.string().optional(),
        search: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      }),
      req.query,
    );
    // Callers without the full audit permission only see the module they are licensed & authorised for.
    const full = req.ctx.permissions.has('platform.audit.read');
    const allowedModules = full ? undefined : [req.ctx.permissions.has('hq.config.read') ? 'HQ' : null, req.ctx.permissions.has('dispense.scripts.read') ? 'DISPENSE' : null].filter(Boolean) as string[];
    if (q.module && allowedModules && !allowedModules.includes(q.module)) throw forbidden();
    return prisma.auditEvent.findMany({
      where: {
        tenantId,
        module: q.module ?? (allowedModules ? { in: allowedModules } : undefined),
        entityType: q.entityType,
        entityId: q.entityId,
        ...(q.search ? { OR: [{ summary: { contains: q.search } }, { userName: { contains: q.search } }, { action: { contains: q.search } }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
  });

  app.get('/audit/verify', { preHandler: requirePermission('platform.audit.read') }, async (req) => verifyAuditChain(tenantOf(req)));
}
