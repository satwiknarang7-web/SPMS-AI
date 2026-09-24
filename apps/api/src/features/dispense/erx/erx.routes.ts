import type { FastifyInstance } from 'fastify';
import { requirePermission, tenantOf } from '../../../core/auth';
import { prisma } from '../../../core/db';
import { conflict, notFound } from '../../../core/errors';
import { hydrateTokens } from '../shared/dispense.shared';

export async function erxRoutes(app: FastifyInstance) {
  app.get<{ Params: { token: string } }>('/erx/:token', { preHandler: requirePermission('dispense.scripts.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const token = await prisma.erxToken.findFirst({ where: { tenantId, token: req.params.token.trim().toUpperCase() } });
    if (!token) throw notFound('Electronic prescription token');
    if (token.claimed) throw conflict('This token has already been dispensed');
    const [hydrated] = await hydrateTokens([token]);
    return hydrated;
  });
}
