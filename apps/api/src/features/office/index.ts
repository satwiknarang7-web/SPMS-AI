import type { FastifyInstance } from 'fastify';
import { authenticate, requireModule } from '../../core/auth';
import { dashboardRoutes } from './dashboard/dashboard.routes';
import { productsRoutes } from './products/products.routes';
import { inventoryRoutes } from './inventory/inventory.routes';
import { suppliersRoutes } from './suppliers/suppliers.routes';
import { purchasingRoutes } from './purchasing/purchasing.routes';
import { pricingRoutes } from './pricing/pricing.routes';
import { accountsRoutes } from './accounts/accounts.routes';
import { stocktakeRoutes } from './stocktake/stocktake.routes';
import { reportsRoutes } from './reports/reports.routes';

/**
 * Office module. Every feature route below requires an authenticated user and an
 * active OFFICE licence — enforced here once, for the whole module.
 */
export async function officeModule(app: FastifyInstance) {
  app.addHook('onRequest', authenticate);
  app.addHook('preHandler', requireModule('OFFICE'));
  await app.register(dashboardRoutes);
  await app.register(productsRoutes);
  await app.register(inventoryRoutes);
  await app.register(suppliersRoutes);
  await app.register(purchasingRoutes);
  await app.register(pricingRoutes);
  await app.register(accountsRoutes);
  await app.register(stocktakeRoutes);
  await app.register(reportsRoutes);
}
