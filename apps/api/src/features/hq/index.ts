import type { FastifyInstance } from 'fastify';
import { authenticate, requireModule } from '../../core/auth';
import { dashboardRoutes } from './dashboard/dashboard.routes';
import { storesRoutes } from './stores/stores.routes';
import { dispensePricingRoutes } from './dispense-pricing/dispense-pricing.routes';
import { drugConfigRoutes } from './drug-config/drug-config.routes';
import { retailPricingRoutes } from './retail-pricing/retail-pricing.routes';
import { promotionsRoutes } from './promotions/promotions.routes';
import { priceFilesRoutes } from './price-files/price-files.routes';
import { syncRoutes } from './sync/sync.routes';
import { reportsRoutes } from './reports/reports.routes';
import { catalogueRoutes } from './catalogue/catalogue.routes';

/**
 * Hq module. Every feature route below requires an authenticated user and an
 * active HQ licence — enforced here once, for the whole module.
 */
export async function hqModule(app: FastifyInstance) {
  app.addHook('onRequest', authenticate);
  app.addHook('preHandler', requireModule('HQ'));
  await app.register(dashboardRoutes);
  await app.register(storesRoutes);
  await app.register(dispensePricingRoutes);
  await app.register(drugConfigRoutes);
  await app.register(retailPricingRoutes);
  await app.register(promotionsRoutes);
  await app.register(priceFilesRoutes);
  await app.register(syncRoutes);
  await app.register(reportsRoutes);
  await app.register(catalogueRoutes);
}
