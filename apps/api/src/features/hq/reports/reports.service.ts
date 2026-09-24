import { marginPct } from '@segue/shared';
import { dayKey, lastDays } from '../../../core/dates';
import { prisma, tx } from '../../../core/db';
import { badRequest } from '../../../core/errors';

/**
 * HQ report templates (HQ-RE-01..04). Every template reads de-identified aggregates
 * (StoreDailyMetric) or non-clinical configuration and sales-line data only.
 */
export const REPORT_TEMPLATES = {
  'sales-performance': { title: 'Sales performance', description: 'Revenue, gross profit, baskets and scripts by store.' },
  'pricing-strategy': { title: 'Pricing strategy', description: 'Margins, store price overrides and consistency with the HQ master.' },
  'inventory-health': { title: 'Inventory health', description: 'Stock value, stock-outs and low-stock exposure by store.' },
  'promotion-impact': { title: 'Promotion impact', description: 'Units, revenue and discount given for each promotion.' },
} as const;
export type ReportTemplate = keyof typeof REPORT_TEMPLATES;
export const isReportTemplate = (t: string): t is ReportTemplate => t in REPORT_TEMPLATES;

export interface ReportFilters {
  from?: string;
  to?: string;
  storeIds?: string[];
  groupId?: string;
  category?: string;
}

type ColumnType = 'text' | 'money' | 'number' | 'pct';
export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}
export interface Report {
  template: ReportTemplate;
  title: string;
  from: string;
  to: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, string | number | null>;
  series: { date: string; value: number }[];
  seriesLabel: string;
}

export async function resolveStores(tenantId: string, f: ReportFilters) {
  const stores = await prisma.store.findMany({
    where: {
      tenantId,
      id: f.storeIds?.length ? { in: f.storeIds } : undefined,
      groups: f.groupId ? { some: { groupId: f.groupId } } : undefined,
    },
    orderBy: { code: 'asc' },
  });
  return stores;
}

function range(f: ReportFilters) {
  const to = f.to ?? dayKey(new Date());
  const from = f.from ?? lastDays(30)[0]!;
  if (from > to) throw badRequest('"From" date must be before "to" date');
  return { from, to };
}

const sum = <T>(xs: T[], fn: (x: T) => number) => xs.reduce((s, x) => s + fn(x), 0);

export async function buildReport(tenantId: string, template: ReportTemplate, f: ReportFilters): Promise<Report> {
  const { from, to } = range(f);
  const stores = await resolveStores(tenantId, f);
  const storeIds = stores.map((s) => s.id);
  const metrics = await prisma.storeDailyMetric.findMany({ where: { tenantId, storeId: { in: storeIds }, date: { gte: from, lte: to } }, orderBy: { date: 'asc' } });
  const catSales = (m: (typeof metrics)[number]) => (f.category ? (JSON.parse(m.categorySales) as Record<string, number>)[f.category] ?? 0 : m.retailSales);
  const base = { template, title: REPORT_TEMPLATES[template].title, from, to };

  const seriesOf = (fn: (m: (typeof metrics)[number]) => number) => {
    const byDate = new Map<string, number>();
    for (const m of metrics) byDate.set(m.date, (byDate.get(m.date) ?? 0) + fn(m));
    return [...byDate.entries()].map(([date, value]) => ({ date, value }));
  };

  switch (template) {
    case 'sales-performance': {
      const rows = stores.map((s) => {
        const ms = metrics.filter((m) => m.storeId === s.id);
        const retail = sum(ms, catSales);
        const cost = f.category ? null : sum(ms, (m) => m.retailCost);
        const tx = sum(ms, (m) => m.transactions);
        const scriptRevenue = sum(ms, (m) => m.scriptRevenue);
        return {
          store: `${s.code} · ${s.name}`,
          retailSales: retail,
          grossProfit: cost == null ? null : retail - cost,
          marginPct: cost == null ? null : marginPct(retail, cost),
          transactions: tx,
          avgBasket: tx ? Math.round(sum(ms, (m) => m.retailSales) / tx) : 0,
          scripts: sum(ms, (m) => m.scripts),
          scriptRevenue,
          totalRevenue: retail + scriptRevenue,
        };
      });
      const totRetail = sum(rows, (r) => r.retailSales);
      const totGp = f.category ? null : sum(rows, (r) => r.grossProfit ?? 0);
      const totTx = sum(rows, (r) => r.transactions);
      return {
        ...base,
        columns: [
          { key: 'store', label: 'Store', type: 'text' },
          { key: 'retailSales', label: f.category ? `${f.category} sales` : 'Retail sales', type: 'money' },
          { key: 'grossProfit', label: 'Gross profit', type: 'money' },
          { key: 'marginPct', label: 'Margin', type: 'pct' },
          { key: 'transactions', label: 'Transactions', type: 'number' },
          { key: 'avgBasket', label: 'Avg basket', type: 'money' },
          { key: 'scripts', label: 'Scripts', type: 'number' },
          { key: 'scriptRevenue', label: 'Script revenue', type: 'money' },
          { key: 'totalRevenue', label: 'Total revenue', type: 'money' },
        ],
        rows,
        totals: {
          store: 'Group total', retailSales: totRetail, grossProfit: totGp, marginPct: totGp == null || !totRetail ? null : (totGp / totRetail) * 100,
          transactions: totTx, avgBasket: totTx ? Math.round(totRetail / totTx) : 0, scripts: sum(rows, (r) => r.scripts),
          scriptRevenue: sum(rows, (r) => r.scriptRevenue), totalRevenue: sum(rows, (r) => r.totalRevenue),
        },
        series: seriesOf((m) => catSales(m) + (f.category ? 0 : m.scriptRevenue)),
        seriesLabel: 'Revenue',
      };
    }

    case 'pricing-strategy': {
      const storeProducts = await prisma.storeProduct.findMany({
        where: { storeId: { in: storeIds }, product: { department: 'FRONT_SHOP', isActive: true, category: f.category } },
        include: { product: { select: { retailPrice: true } } },
      });
      const rules = await prisma.publicationTarget.groupBy({ by: ['storeId'], where: { storeId: { in: storeIds }, status: 'APPLIED', publication: { kind: 'DISPENSE_PRICING', status: 'PUBLISHED' } }, _count: true });
      const rows = stores.map((s) => {
        const ms = metrics.filter((m) => m.storeId === s.id);
        const retail = sum(ms, (m) => m.retailSales);
        const cost = sum(ms, (m) => m.retailCost);
        const sps = storeProducts.filter((sp) => sp.storeId === s.id);
        const overrides = sps.filter((sp) => sp.retailPrice != null);
        const inconsistent = overrides.filter((sp) => sp.retailPrice !== sp.product.retailPrice);
        const scripts = sum(ms, (m) => m.scripts);
        return {
          store: `${s.code} · ${s.name}`,
          marginPct: marginPct(retail, cost),
          overrides: overrides.length,
          inconsistencies: inconsistent.length,
          consistencyPct: sps.length ? ((sps.length - inconsistent.length) / sps.length) * 100 : 100,
          dispenseRules: rules.find((r) => r.storeId === s.id)?._count ?? 0,
          avgScriptValue: scripts ? Math.round(sum(ms, (m) => m.scriptRevenue) / scripts) : 0,
        };
      });
      return {
        ...base,
        columns: [
          { key: 'store', label: 'Store', type: 'text' },
          { key: 'marginPct', label: 'Retail margin', type: 'pct' },
          { key: 'overrides', label: 'Store price overrides', type: 'number' },
          { key: 'inconsistencies', label: 'Differs from HQ master', type: 'number' },
          { key: 'consistencyPct', label: 'Price consistency', type: 'pct' },
          { key: 'dispenseRules', label: 'Active dispense rules', type: 'number' },
          { key: 'avgScriptValue', label: 'Avg script value', type: 'money' },
        ],
        rows,
        totals: { store: 'Group', marginPct: marginPct(sum(metrics, (m) => m.retailSales), sum(metrics, (m) => m.retailCost)), overrides: sum(rows, (r) => r.overrides), inconsistencies: sum(rows, (r) => r.inconsistencies), consistencyPct: null, dispenseRules: null, avgScriptValue: null },
        series: seriesOf((m) => m.retailSales - m.retailCost),
        seriesLabel: 'Gross profit',
      };
    }

    case 'inventory-health': {
      const stock = await prisma.storeProduct.findMany({ where: { storeId: { in: storeIds }, product: { isActive: true, category: f.category } }, select: { storeId: true, onHand: true, reorderPoint: true } });
      const rows = stores.map((s) => {
        const ms = metrics.filter((m) => m.storeId === s.id);
        const latest = ms[ms.length - 1];
        const sp = stock.filter((x) => x.storeId === s.id);
        const cogs = sum(ms, (m) => m.retailCost);
        const periodDays = Math.max(1, ms.length);
        return {
          store: `${s.code} · ${s.name}`,
          stockValue: latest?.stockValue ?? 0,
          stockouts: sp.filter((x) => x.reorderPoint > 0 && x.onHand <= 0).length,
          lowStock: sp.filter((x) => x.reorderPoint > 0 && x.onHand > 0 && x.onHand <= x.reorderPoint).length,
          negative: sp.filter((x) => x.onHand < 0).length,
          daysCover: cogs ? Math.round((latest?.stockValue ?? 0) / (cogs / periodDays)) : null,
          skus: sp.length,
        };
      });
      return {
        ...base,
        columns: [
          { key: 'store', label: 'Store', type: 'text' },
          { key: 'stockValue', label: 'Stock value (cost)', type: 'money' },
          { key: 'daysCover', label: 'Days of cover', type: 'number' },
          { key: 'stockouts', label: 'Stock-outs', type: 'number' },
          { key: 'lowStock', label: 'Below reorder point', type: 'number' },
          { key: 'negative', label: 'Negative stock', type: 'number' },
          { key: 'skus', label: 'SKUs ranged', type: 'number' },
        ],
        rows,
        totals: { store: 'Group total', stockValue: sum(rows, (r) => r.stockValue), daysCover: null, stockouts: sum(rows, (r) => r.stockouts), lowStock: sum(rows, (r) => r.lowStock), negative: sum(rows, (r) => r.negative), skus: null },
        series: seriesOf((m) => m.stockValue),
        seriesLabel: 'Stock value',
      };
    }

    case 'promotion-impact': {
      const promos = await prisma.promotion.findMany({ where: { tenantId, status: { in: ['PUBLISHED', 'ROLLED_BACK'] }, startsAt: { lte: new Date(`${to}T23:59:59`) }, endsAt: { gte: new Date(`${from}T00:00:00`) } }, orderBy: { startsAt: 'desc' } });
      const lines = await prisma.saleLine.findMany({
        where: { promotionId: { in: promos.map((p) => p.id) }, sale: { storeId: { in: storeIds }, createdAt: { gte: new Date(`${from}T00:00:00`), lte: new Date(`${to}T23:59:59`) } } },
        select: { promotionId: true, quantity: true, lineTotal: true, discount: true, unitCost: true },
      });
      const rows = promos.map((p) => {
        const ls = lines.filter((l) => l.promotionId === p.id);
        const revenue = sum(ls, (l) => l.lineTotal);
        const cost = sum(ls, (l) => l.unitCost * l.quantity);
        return {
          promotion: p.name,
          mechanism: p.type === 'PERCENT_OFF' ? `${p.value}% off` : p.type === 'AMOUNT_OFF' ? `$${(p.value / 100).toFixed(2)} off` : `Now $${(p.value / 100).toFixed(2)}`,
          period: `${dayKey(p.startsAt)} → ${dayKey(p.endsAt)}`,
          stores: (JSON.parse(p.storeIds) as string[]).filter((id) => storeIds.includes(id)).length,
          units: sum(ls, (l) => l.quantity),
          revenue,
          discountGiven: sum(ls, (l) => l.discount),
          grossProfit: revenue - cost,
          status: p.status,
        };
      });
      return {
        ...base,
        columns: [
          { key: 'promotion', label: 'Promotion', type: 'text' },
          { key: 'mechanism', label: 'Mechanism', type: 'text' },
          { key: 'period', label: 'Period', type: 'text' },
          { key: 'stores', label: 'Stores', type: 'number' },
          { key: 'units', label: 'Units sold', type: 'number' },
          { key: 'revenue', label: 'Revenue', type: 'money' },
          { key: 'discountGiven', label: 'Discount given', type: 'money' },
          { key: 'grossProfit', label: 'Gross profit', type: 'money' },
          { key: 'status', label: 'Status', type: 'text' },
        ],
        rows,
        totals: { promotion: 'All promotions', units: sum(rows, (r) => r.units), revenue: sum(rows, (r) => r.revenue), discountGiven: sum(rows, (r) => r.discountGiven), grossProfit: sum(rows, (r) => r.grossProfit) },
        series: seriesOf((m) => m.promoSales),
        seriesLabel: 'Promotional sales',
      };
    }
  }
}

export function reportToCsv(r: Report): string {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const fmt = (c: ReportColumn, v: unknown) => {
    if (v == null || v === '') return '';
    if (c.type === 'money') return (Number(v) / 100).toFixed(2);
    if (c.type === 'pct') return Number(v).toFixed(1);
    return v;
  };
  const header = r.columns.map((c) => esc(c.type === 'money' ? `${c.label} (AUD)` : c.type === 'pct' ? `${c.label} (%)` : c.label)).join(',');
  const body = [...r.rows, r.totals].map((row) => r.columns.map((c) => esc(fmt(c, row[c.key]))).join(','));
  return [`# ${r.title} — ${r.from} to ${r.to}`, header, ...body].join('\n');
}

/* ----------------------------- Scheduled delivery ----------------------------- */

const CADENCE_DAYS: Record<string, number> = { DAILY: 1, WEEKLY: 7, MONTHLY: 30 };

export function nextRun(cadence: string, from = new Date()) {
  const next = new Date(from.getTime() + (CADENCE_DAYS[cadence] ?? 7) * 86_400_000);
  next.setHours(7, 0, 0, 0); // delivered before trading opens
  return next;
}

/** Render due schedules and hand them to the email adapter (the outbox, in development). */
export async function runDueReportSchedules(now = new Date()) {
  const due = await prisma.reportSchedule.findMany({ where: { nextRunAt: { lte: now } } });
  for (const s of due) {
    if (!isReportTemplate(s.template)) continue;
    const period = CADENCE_DAYS[s.cadence] ?? 7;
    const filters = { ...(JSON.parse(s.filters) as ReportFilters), from: lastDays(period)[0], to: dayKey(now) };
    const report = await buildReport(s.tenantId, s.template, filters);
    const csv = reportToCsv(report);
    await tx(async (db) => {
      await db.emailOutbox.create({
        data: {
          tenantId: s.tenantId, to: s.recipients, subject: `Segue HQ · ${report.title} (${report.from} → ${report.to})`,
          body: `Your scheduled ${s.cadence.toLowerCase()} ${report.title.toLowerCase()} report is attached.`,
          attachmentName: `${s.template}-${report.to}.csv`, attachment: csv,
        },
      });
      await db.reportSchedule.update({ where: { id: s.id }, data: { lastRunAt: now, nextRunAt: nextRun(s.cadence, now) } });
    });
  }
  return due.length;
}
