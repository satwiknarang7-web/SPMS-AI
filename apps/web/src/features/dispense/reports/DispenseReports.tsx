'use client';

import { useQuery } from '@tanstack/react-query';
import { Activity, AlertOctagon, DollarSign, Landmark, Pill } from 'lucide-react';
import { useState } from 'react';
import { PageBody } from '@/components/layout/AppShell';
import { Card, CardHeader, Loading, PageHeader, Stat, Tabs } from '@/components/ui';
import { BarsChart, DonutChart, TrendChart } from '@/components/ui/charts';
import { api } from '@/lib/api';
import { money, moneyCompact, num } from '@/lib/format';

export interface Report {
  total: number;
  patientRevenue: number;
  govtRevenue: number;
  interventions: number;
  s8: number;
  byDay: { date: string; scripts: number }[];
  byType: { type: string; count: number }[];
  topDrugs: { name: string; count: number }[];
  workload: { name: string; count: number }[];
  topPrescribers: { name: string; count: number }[];
}

export function DispenseReports() {
  const [days, setDays] = useState('30');
  const { data, isLoading } = useQuery({ queryKey: ['dispense', 'reports', days], queryFn: () => api.get<Report>('/dispense/reports', { days }) });
  return (
    <PageBody>
      <PageHeader title="Dispensing reports" subtitle="Volume, workload and revenue for this store" actions={<Tabs value={days} onChange={setDays} tabs={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />} />
      {isLoading || !data ? (
        <Loading />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Scripts dispensed" value={num(data.total)} icon={<Pill />} hint={`${(data.total / Number(days)).toFixed(0)} per day`} />
            <Stat label="Patient revenue" value={moneyCompact(data.patientRevenue)} icon={<DollarSign />} />
            <Stat label="Government contribution" value={moneyCompact(data.govtRevenue)} icon={<Landmark />} />
            <Stat label="Clinical interventions" value={num(data.interventions)} icon={<AlertOctagon />} tone="amber" hint={`${data.s8} S8 supplies`} />
          </div>
          <Card>
            <CardHeader title="Scripts per day" icon={<Activity />} />
            <TrendChart data={data.byDay} series={[{ key: 'scripts', label: 'Scripts', color: 'var(--accent)' }]} format={(v) => num(v)} />
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Most dispensed medicines" />
              <BarsChart data={data.topDrugs} xKey="name" layout="vertical" height={320} series={[{ key: 'count', label: 'Scripts', color: 'var(--accent)' }]} format={(v) => num(v)} />
            </Card>
            <Card>
              <CardHeader title="Script type mix" />
              <DonutChart data={data.byType.map((t) => ({ name: t.type, value: t.count }))} format={(v) => num(v)} />
              <CardHeader title="Pharmacist workload" className="mt-8" />
              <ul className="space-y-2 text-sm">
                {data.workload.map((w) => (
                  <li key={w.name} className="flex justify-between"><span className="text-ink-700">{w.name}</span><span className="font-semibold tnum">{num(w.count)}</span></li>
                ))}
              </ul>
              <CardHeader title="Top prescribers" className="mt-8" />
              <ul className="space-y-2 text-sm">
                {data.topPrescribers.map((w) => (
                  <li key={w.name} className="flex justify-between"><span className="text-ink-700">{w.name}</span><span className="font-semibold tnum">{num(w.count)}</span></li>
                ))}
              </ul>
            </Card>
          </div>
          <p className="text-xs text-ink-400">Average patient charge {money(data.total ? Math.round(data.patientRevenue / data.total) : 0)} per script.</p>
        </div>
      )}
    </PageBody>
  );
}
