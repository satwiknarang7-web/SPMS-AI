import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../core/auth';
import { licenceRoutes } from './licence/licence.routes';
import { integrationsRoutes } from './integrations/integrations.routes';
import { usersRoutes } from './users/users.routes';
import { auditRoutes } from './audit/audit.routes';
import { catalogueRoutes } from './catalogue/catalogue.routes';

/** Platform services available to every authenticated user, regardless of licensed modules. */
export async function platformModule(app: FastifyInstance) {
  app.addHook('onRequest', authenticate);
  await app.register(licenceRoutes);
  await app.register(integrationsRoutes);
  await app.register(usersRoutes);
  await app.register(auditRoutes);
  await app.register(catalogueRoutes);
}
