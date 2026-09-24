import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission, storeOf, tenantOf } from '../../../core/auth';
import { prisma } from '../../../core/db';
import { parse } from '../../../core/errors';
import { lookupPbsCode } from '../../../integrations/pbs/pbs.sync';
import { searchDrugs } from '../shared/dispense.service';

export async function medicinesRoutes(app: FastifyInstance) {
  app.get('/drugs', { preHandler: requirePermission('dispense.scripts.read') }, async (req) => {
    const { q } = parse(z.object({ q: z.string().min(2) }), req.query);
    return searchDrugs(prisma, tenantOf(req), storeOf(req), q);
  });

  /** PBS schedule lookup — local mirror of the PBS Data API, live API as a fallback. */
  app.get<{ Params: { code: string } }>('/pbs/:code', { preHandler: requirePermission('dispense.scripts.read') }, async (req) => lookupPbsCode(req.params.code.trim().toUpperCase()));
}
