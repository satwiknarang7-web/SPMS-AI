import { MODULE_KEYS, ROLES, ROLE_LABELS, isSubscriptionUsable, permissionModule, ROLE_PERMISSIONS } from '@segue/shared';
import type { FastifyInstance } from 'fastify';
import { tenantOf } from '../../../core/auth';
import { prisma } from '../../../core/db';

export async function licenceRoutes(app: FastifyInstance) {
  app.get('/licence', async (req) => {
    const tenantId = tenantOf(req);
    const subs = await prisma.subscription.findMany({ where: { tenantId } });
    return MODULE_KEYS.map((module) => {
      const s = subs.find((x) => x.module === module);
      return {
        module,
        status: s?.status ?? 'NOT_PURCHASED',
        expiresAt: s?.expiresAt ?? null,
        seats: s?.seats ?? null,
        usable: s ? isSubscriptionUsable(s) : false,
      };
    });
  });

  app.get('/roles', async () =>
    ROLES.map((r) => ({
      key: r,
      label: ROLE_LABELS[r],
      permissions: ROLE_PERMISSIONS[r],
      modules: [...new Set(ROLE_PERMISSIONS[r].map(permissionModule).filter(Boolean))],
    })),
  );
}
