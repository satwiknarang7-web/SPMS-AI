import type { FastifyInstance } from 'fastify';
import { requirePermission, storeOf } from '../../../core/auth';
import { prisma } from '../../../core/db';

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard', { preHandler: requirePermission('dispense.scripts.read') }, async (req) => {
    const storeId = storeOf(req);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [byStatus, today, recent, pbsToday] = await Promise.all([
      prisma.prescription.groupBy({ by: ['status'], where: { storeId }, _count: true }),
      prisma.prescription.count({ where: { storeId, dispensedAt: { gte: startOfDay } } }),
      prisma.prescription.findMany({
        where: { storeId },
        orderBy: { updatedAt: 'desc' },
        take: 8,
        include: { patient: { select: { firstName: true, lastName: true } }, drug: { select: { brandName: true, strength: true } } },
      }),
      prisma.prescription.count({ where: { storeId, dispensedAt: { gte: startOfDay }, scriptType: { in: ['PBS', 'RPBS'] } } }),
    ]);
    const counts = Object.fromEntries(byStatus.map((s) => [s.status, s._count]));
    return { counts, dispensedToday: today, pbsToday, recent };
  });
}
