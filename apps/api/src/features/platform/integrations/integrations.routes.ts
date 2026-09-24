import type { FastifyInstance } from 'fastify';
import { actorFrom, audit } from '../../../core/audit';
import { requireAnyPermission } from '../../../core/auth';
import { tx } from '../../../core/db';
import { syncPbsSchedule } from '../../../integrations/pbs/pbs.sync';
import { integrationStatus } from '../../../integrations/registry';

export async function integrationsRoutes(app: FastifyInstance) {
  app.get('/integrations', { preHandler: requireAnyPermission('platform.users.manage', 'platform.audit.read', 'hq.config.read') }, async () => integrationStatus());

  app.post('/integrations/pbs/sync', { preHandler: requireAnyPermission('platform.users.manage', 'hq.drugconfig.write', 'hq.pricing.write') }, async (req) => {
    const result = await syncPbsSchedule();
    await tx((db) => audit(db, actorFrom(req), { module: 'PLATFORM', action: 'integration.pbs.sync', entityType: 'Integration', entityId: 'PBS', summary: `PBS schedule sync: ${result.status} (${result.records} items)` }));
    return result;
  });
}
