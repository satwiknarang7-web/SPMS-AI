'use client';

import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, DollarSign, Percent, Pill, RefreshCw, ShoppingBag, WifiOff } from 'lucide-react';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageBody } from '@/components/layout/AppShell';
import { Badge, Button, Card, CardHeader, Loading, PageHeader, Select, Sparkline, Stat, Table, Tabs, TD, TH, THead, TR } from '@/components/ui';
import { DonutChart, TrendChart } from '@/components/ui/charts';
import { useGroups } from '@/features/hq/shared/groups';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { date, money, moneyCompact, num, pct, relative } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface Kpi { revenue: number; retail: number; grossProfit: number; marginPct: number; scripts: number; transactions: number; avgBasket: number }

export interface Dashboard {
  period: { from: string; to: string; days: number };
  kpis: { current: Kpi; previous: Kpi };
  trend: { date: string; retail: number; scripts: number }[];
  categories: { category: string; value: number }[];
  league: { storeId: string; code: string; name: string; state: string; online: boolean; status: string; revenue: number; growthPct: number | null; marginPct: number; scripts: number; spark: number[] }[];
  sync: { queued: number; failed: number; offline: number; stores: number; lastCollectedAt: string | null };
}

export const delta = (a: number, b: number) => (b ? ((a - b) / b) * 100 : null);

export function HqDashboard() {
  const router = useRouter();
  const [days, setDays] = useState('30');
  const [groupId, setGroupId] = useState('');
  const groups = useGroups();
  const { data, isLoading } = useQuery({ queryKey: ['hq', 'dashboard', days, groupId], queryFn: () => api.get<Dashboard>('/hq/dashboard', { days, groupId }) });
  const collect = useAction(() => api.post('/hq/sync/collect'), { success: 'Store data collected', invalidate: [['hq', 'dashboard']] });
  const c = data?.kpis.current;
  const p = data?.kpis.previous;
  return (
    <PageBody wide>
      <PageHeader eyebrow="Head office" title="Group performance" subtitle={data && `${date(data.period.from)} – ${date(data.period.to)} · de-identified store aggregates`}
        actions={<>
          <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="w-52"><option value="">All stores</option>{groups.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select>
          <Tabs value={days} onChange={setDays} tabs={[{ value: '7', label: '7d' }, { value: '30', label: '30d' }, { value: '90', label: '90d' }]} />
        </>} />
      {isLoading || !data || !c || !p ? <Loading /> : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Stat label="Total revenue" value={moneyCompact(c.revenue)} delta={delta(c.revenue, p.revenue)} hint="vs previous period" icon={<DollarSign />} />
            <Stat label="Retail gross profit" value={moneyCompact(c.grossProfit)} delta={delta(c.grossProfit, p.grossProfit)} icon={<Activity />} />
            <Stat label="Retail margin" value={pct(c.marginPct)} hint={`prev ${pct(p.marginPct)}`} icon={<Percent />} tone="green" />
            <Stat label="Scripts dispensed" value={num(c.scripts)} delta={delta(c.scripts, p.scripts)} icon={<Pill />} />
            <Stat label="Avg basket" value={money(c.avgBasket)} delta={delta(c.avgBasket, p.avgBasket)} icon={<ShoppingBag />} />
          </div>
          <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
            <Card>
              <CardHeader title="Revenue trend" subtitle="Retail and dispensing revenue across the group" />
              <TrendChart data={data.trend} stacked series={[{ key: 'scripts', label: 'Dispensing', color: '#0284c7' }, { key: 'retail', label: 'Retail', color: 'var(--accent)' }]} />
            </Card>
            <Card>
              <CardHeader title="Sync health" icon={<RefreshCw />} actions={<Button size="xs" loading={collect.isPending} onClick={() => collect.mutate(undefined)}>Collect now</Button>} />
              <div className="space-y-3">
                <HealthRow ok={data.sync.offline === 0} label="Stores online" value={`${data.sync.stores - data.sync.offline} / ${data.sync.stores}`} icon={data.sync.offline ? <WifiOff className="size-4" /> : undefined} />
                <HealthRow ok={data.sync.queued === 0} label="Deliveries queued" value={data.sync.queued} />
                <HealthRow ok={data.sync.failed === 0} label="Deliveries failed" value={data.sync.failed} />
                <div className="text-xs text-ink-500">Store data last collected {relative(data.sync.lastCollectedAt)}</div>
                <Link href="/hq/sync" className="text-sm font-medium text-[var(--accent)]">Open publishing & sync →</Link>
              </div>
              <CardHeader title="Category mix" className="mt-6" />
              <DonutChart data={data.categories.map((x) => ({ name: x.category, value: x.value }))} height={160} />
            </Card>
          </div>
          <Card padded={false}>
            <div className="p-5 pb-0"><CardHeader title="Store comparison" subtitle="Ranked by revenue for the period" /></div>
            <Table>
              <THead><tr><TH>#</TH><TH>Store</TH><TH align="right">Revenue</TH><TH align="right">Growth</TH><TH align="right">Retail margin</TH><TH align="right">Scripts</TH><TH>Last 14 days</TH><TH>Status</TH></tr></THead>
              <tbody>
                {data.league.map((s, i) => (
                  <TR key={s.storeId} onClick={() => router.push(`/hq/stores/${s.storeId}`)}>
                    <TD className="font-semibold text-ink-400">{i + 1}</TD>
                    <TD><span className="font-medium text-ink-900">{s.name}</span><span className="block text-xs text-ink-500">{s.code} · {s.state}</span></TD>
                    <TD align="right" className="font-semibold text-ink-900">{moneyCompact(s.revenue)}</TD>
                    <TD align="right" className={cn(s.growthPct != null && (s.growthPct >= 0 ? 'text-emerald-600' : 'text-rose-600'))}>{s.growthPct == null ? '—' : `${s.growthPct >= 0 ? '+' : ''}${s.growthPct.toFixed(1)}%`}</TD>
                    <TD align="right">{pct(s.marginPct)}</TD>
                    <TD align="right">{num(s.scripts)}</TD>
                    <TD><Sparkline values={s.spark} /></TD>
                    <TD>{s.status !== 'ACTIVE' ? <Badge tone="red">Suspended</Badge> : s.online ? <Badge tone="green" dot>Online</Badge> : <Badge tone="amber" dot>Offline</Badge>}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
    </PageBody>
  );
}

export function HealthRow({ ok, label, value, icon }: { ok: boolean; label: string; value: string | number; icon?: React.ReactNode }) {
  return (
    <div className={cn('flex items-center justify-between rounded-xl px-3 py-2.5 text-sm ring-1', ok ? 'bg-emerald-50 text-emerald-900 ring-emerald-200' : 'bg-amber-50 text-amber-900 ring-amber-200')}>
      <span className="flex items-center gap-2">{!ok && (icon ?? <AlertTriangle className="size-4" />)}{label}</span>
      <span className="font-semibold tnum">{value}</span>
    </div>
  );
}
