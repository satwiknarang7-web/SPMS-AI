import { marginPct } from '@segue/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission, tenantOf } from '../../../core/auth';
import { lastDays } from '../../../core/dates';
import { json, prisma, tx } from '../../../core/db';
import { parse } from '../../../core/errors';

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard', { preHandler: requirePermission('hq.reports.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const q = parse(z.object({ days: z.coerce.number().int().min(7).max(180).default(30), groupId: z.string().optional() }), req.query);
    const current = lastDays(q.days);
    const previous = lastDays(q.days, new Date(Date.now() - q.days * 86_400_000));
    const stores = await prisma.store.findMany({ where: { tenantId, groups: q.groupId ? { some: { groupId: q.groupId } } : undefined }, orderBy: { code: 'asc' } });
    const storeIds = stores.map((s) => s.id);
    const metrics = await prisma.storeDailyMetric.findMany({ where: { tenantId, storeId: { in: storeIds }, date: { gte: previous[0], lte: current[current.length - 1] } } });
    const inRange = (d: string, r: string[]) => d >= r[0]! && d <= r[r.length - 1]!;
    const kpi = (r: string[]) => {
      const ms = metrics.filter((m) => inRange(m.date, r));
      const retail = ms.reduce((s, m) => s + m.retailSales, 0);
      const cost = ms.reduce((s, m) => s + m.retailCost, 0);
      const scriptRevenue = ms.reduce((s, m) => s + m.scriptRevenue, 0);
      const tx = ms.reduce((s, m) => s + m.transactions, 0);
      return { revenue: retail + scriptRevenue, retail, grossProfit: retail - cost, marginPct: marginPct(retail, cost), scripts: ms.reduce((s, m) => s + m.scripts, 0), transactions: tx, avgBasket: tx ? Math.round(retail / tx) : 0 };
    };
    const trend = current.map((date) => {
      const ms = metrics.filter((m) => m.date === date);
      return { date, retail: ms.reduce((s, m) => s + m.retailSales, 0), scripts: ms.reduce((s, m) => s + m.scriptRevenue, 0) };
    });
    const categories: Record<string, number> = {};
    for (const m of metrics.filter((x) => inRange(x.date, current))) {
      for (const [k, v] of Object.entries(json.parse<Record<string, number>>(m.categorySales, {}))) categories[k] = (categories[k] ?? 0) + v;
    }
    const league = stores.map((s) => {
      const ms = metrics.filter((m) => m.storeId === s.id && inRange(m.date, current));
      const prev = metrics.filter((m) => m.storeId === s.id && inRange(m.date, previous));
      const rev = ms.reduce((a, m) => a + m.retailSales + m.scriptRevenue, 0);
      const prevRev = prev.reduce((a, m) => a + m.retailSales + m.scriptRevenue, 0);
      const retail = ms.reduce((a, m) => a + m.retailSales, 0);
      const cost = ms.reduce((a, m) => a + m.retailCost, 0);
      return {
        storeId: s.id, code: s.code, name: s.name, state: s.state, online: s.online, status: s.status,
        revenue: rev, growthPct: prevRev ? ((rev - prevRev) / prevRev) * 100 : null, marginPct: marginPct(retail, cost), scripts: ms.reduce((a, m) => a + m.scripts, 0),
        spark: current.slice(-14).map((d) => ms.filter((m) => m.date === d).reduce((a, m) => a + m.retailSales + m.scriptRevenue, 0)),
      };
    }).sort((a, b) => b.revenue - a.revenue);
    const [queued, failed, lastCollected] = await Promise.all([
      prisma.publicationTarget.count({ where: { status: 'QUEUED', publication: { tenantId, status: 'PUBLISHED' } } }),
      prisma.publicationTarget.count({ where: { status: 'FAILED', publication: { tenantId } } }),
      prisma.storeDailyMetric.findFirst({ where: { tenantId }, orderBy: { collectedAt: 'desc' }, select: { collectedAt: true } }),
    ]);
    return {
      period: { from: current[0], to: current[current.length - 1], days: q.days },
      kpis: { current: kpi(current), previous: kpi(previous) },
      trend,
      categories: Object.entries(categories).map(([category, value]) => ({ category, value })).sort((a, b) => b.value - a.value),
      league,
      sync: { queued, failed, offline: stores.filter((s) => !s.online).length, stores: stores.length, lastCollectedAt: lastCollected?.collectedAt ?? null },
    };
  });
}
