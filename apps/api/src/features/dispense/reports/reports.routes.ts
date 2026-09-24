import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission, storeOf } from '../../../core/auth';
import { dayKey, lastDays } from '../../../core/dates';
import { prisma } from '../../../core/db';
import { parse } from '../../../core/errors';

export async function reportsRoutes(app: FastifyInstance) {
  app.get('/reports', { preHandler: requirePermission('dispense.reports.read') }, async (req) => {
    const storeId = storeOf(req);
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query);
    const since = new Date(Date.now() - days * 86_400_000);
    const scripts = await prisma.prescription.findMany({
      where: { storeId, dispensedAt: { gte: since } },
      select: { dispensedAt: true, scriptType: true, patientPrice: true, governmentContribution: true, checkedById: true, prescriberId: true, drug: { select: { genericName: true, strength: true, schedule: true } } },
    });
    const interventions = await prisma.clinicalIntervention.count({ where: { createdAt: { gte: since }, prescription: { storeId } } });
    const byDay = new Map<string, number>();
    const byType = new Map<string, number>();
    const byDrug = new Map<string, number>();
    const byPharmacist = new Map<string, number>();
    const byPrescriber = new Map<string, number>();
    let patientRevenue = 0;
    let govtRevenue = 0;
    let s8 = 0;
    for (const s of scripts) {
      const d = dayKey(s.dispensedAt!);
      byDay.set(d, (byDay.get(d) ?? 0) + 1);
      byType.set(s.scriptType, (byType.get(s.scriptType) ?? 0) + 1);
      const drug = `${s.drug.genericName} ${s.drug.strength}`;
      byDrug.set(drug, (byDrug.get(drug) ?? 0) + 1);
      if (s.checkedById) byPharmacist.set(s.checkedById, (byPharmacist.get(s.checkedById) ?? 0) + 1);
      byPrescriber.set(s.prescriberId, (byPrescriber.get(s.prescriberId) ?? 0) + 1);
      patientRevenue += s.patientPrice ?? 0;
      govtRevenue += s.governmentContribution ?? 0;
      if (s.drug.schedule === 'S8') s8++;
    }
    const [users, prescribers] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: [...byPharmacist.keys()] } }, select: { id: true, name: true } }),
      prisma.prescriber.findMany({ where: { id: { in: [...byPrescriber.keys()] } }, select: { id: true, name: true } }),
    ]);
    const days_ = lastDays(days);
    const top = (m: Map<string, number>, n = 10) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
    return {
      total: scripts.length,
      patientRevenue,
      govtRevenue,
      interventions,
      s8,
      byDay: days_.map((date) => ({ date, scripts: byDay.get(date) ?? 0 })),
      byType: [...byType.entries()].map(([type, count]) => ({ type, count })),
      topDrugs: top(byDrug).map(([name, count]) => ({ name, count })),
      workload: top(byPharmacist).map(([id, count]) => ({ name: users.find((u) => u.id === id)?.name ?? 'Unknown', count })),
      topPrescribers: top(byPrescriber, 8).map(([id, count]) => ({ name: prescribers.find((p) => p.id === id)?.name ?? 'Unknown', count })),
    };
  });
}
