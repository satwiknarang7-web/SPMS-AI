import type { FastifyInstance } from 'fastify';
import { authenticate, requireModule } from '../../core/auth';
import { shiftsRoutes } from './shifts/shifts.routes';
import { catalogueRoutes } from './catalogue/catalogue.routes';
import { salesRoutes } from './sales/sales.routes';
import { customersRoutes } from './customers/customers.routes';
import { laybysRoutes } from './laybys/laybys.routes';
import { hireRoutes } from './hire/hire.routes';

/**
 * Pos module. Every feature route below requires an authenticated user and an
 * active POS licence — enforced here once, for the whole module.
 */
export async function posModule(app: FastifyInstance) {
  app.addHook('onRequest', authenticate);
  app.addHook('preHandler', requireModule('POS'));
  await app.register(shiftsRoutes);
  await app.register(catalogueRoutes);
  await app.register(salesRoutes);
  await app.register(customersRoutes);
  await app.register(laybysRoutes);
  await app.register(hireRoutes);
}
