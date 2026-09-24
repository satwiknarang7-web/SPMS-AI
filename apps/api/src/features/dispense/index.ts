import type { FastifyInstance } from 'fastify';
import { authenticate, requireModule } from '../../core/auth';
import { dashboardRoutes } from './dashboard/dashboard.routes';
import { patientsRoutes } from './patients/patients.routes';
import { prescribersRoutes } from './prescribers/prescribers.routes';
import { medicinesRoutes } from './medicines/medicines.routes';
import { erxRoutes } from './erx/erx.routes';
import { scriptsRoutes } from './scripts/scripts.routes';
import { reportsRoutes } from './reports/reports.routes';

/**
 * Dispense module. Every feature route below requires an authenticated user and an
 * active DISPENSE licence — enforced here once, for the whole module.
 */
export async function dispenseModule(app: FastifyInstance) {
  app.addHook('onRequest', authenticate);
  app.addHook('preHandler', requireModule('DISPENSE'));
  await app.register(dashboardRoutes);
  await app.register(patientsRoutes);
  await app.register(prescribersRoutes);
  await app.register(medicinesRoutes);
  await app.register(erxRoutes);
  await app.register(scriptsRoutes);
  await app.register(reportsRoutes);
}
