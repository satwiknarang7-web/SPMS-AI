'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PageBody } from '@/components/layout/AppShell';
import { Alert, Card, CardHeader, EmptyState, Loading, PageHeader, Stat, Table, Tabs, TD, TH, THead, TR } from '@/components/ui';
import { BarsChart, DonutChart, TrendChart } from '@/components/ui/charts';
import { api } from '@/lib/api';
import { money, moneyCompact, num, pct } from '@/lib/format';

export interface SalesReport {
  revenue: number; retailRevenue: number; scriptRevenue: number; grossProfit: number; marginPct: number; transactions: number; avgBasket: number; discounts: number;
  byDay: { date: string; revenue: number; transactions: number }[];
  byCategory: { category: string; revenue: number; grossProfit: number; marginPct: number }[];
}

export interface InventoryReport { byCategory: { category: string; value: number; units: number; skus: number }[]; movementsByReason: { reason: string; quantity: number }[]; slowMovers: { name: string; onHand: number; value: number }[]; negativeStock: number }

export function OfficeReports() {
  const [days, setDays] = useState('30');
  const [tab, setTab] = useState<'sales' | 'inventory'>('sales');
  const sales = useQuery({ queryKey: ['office', 'reports', 'sales', Number(days)], queryFn: () => api.get<SalesReport>('/office/reports/sales', { days }), enabled: tab === 'sales' });
  const inv = useQuery({ queryKey: ['office', 'reports', 'inventory'], queryFn: () => api.get<InventoryReport>('/office/reports/inventory'), enabled: tab === 'inventory' });
  return (
    <PageBody>
      <PageHeader title="Store reports" subtitle="Sales, profitability, inventory and stock movement" actions={<>
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'sales', label: 'Sales & profit' }, { value: 'inventory', label: 'Inventory' }]} />
        {tab === 'sales' && <Tabs value={days} onChange={setDays} tabs={[{ value: '7', label: '7d' }, { value: '30', label: '30d' }, { value: '90', label: '90d' }]} />}
      </>} />
      {tab === 'sales' ? (
        !sales.data ? <Loading /> : (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Revenue" value={moneyCompact(sales.data.revenue)} hint={`Scripts ${moneyCompact(sales.data.scriptRevenue)}`} />
              <Stat label="Retail gross profit" value={moneyCompact(sales.data.grossProfit)} hint={`${pct(sales.data.marginPct)} margin`} tone="green" />
              <Stat label="Transactions" value={num(sales.data.transactions)} hint={`Avg basket ${money(sales.data.avgBasket)}`} />
              <Stat label="Discounts given" value={money(sales.data.discounts)} tone="amber" />
            </div>
            <Card><CardHeader title="Daily revenue" /><TrendChart data={sales.data.byDay} series={[{ key: 'revenue', label: 'Revenue', color: 'var(--accent)' }]} /></Card>
            <Card padded={false}>
              <div className="p-5 pb-0"><CardHeader title="Profitability by category" /></div>
              <Table>
                <THead><tr><TH>Category</TH><TH align="right">Revenue</TH><TH align="right">Gross profit</TH><TH align="right">Margin</TH></tr></THead>
                <tbody>{sales.data.byCategory.map((c) => <TR key={c.category}><TD className="text-ink-900">{c.category}</TD><TD align="right">{money(c.revenue)}</TD><TD align="right">{money(c.grossProfit)}</TD><TD align="right">{pct(c.marginPct)}</TD></TR>)}</tbody>
              </Table>
            </Card>
          </div>
        )
      ) : !inv.data ? <Loading /> : (
        <div className="space-y-6">
          {inv.data.negativeStock > 0 && <Alert tone="amber">{inv.data.negativeStock} item(s) show negative stock — a stocktake will correct them.</Alert>}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card><CardHeader title="Stock value by category (cost)" /><DonutChart data={inv.data.byCategory.map((c) => ({ name: c.category, value: c.value }))} /></Card>
            <Card><CardHeader title="Stock movement (60 days)" subtitle="Net units by reason" /><BarsChart data={inv.data.movementsByReason} xKey="reason" series={[{ key: 'quantity', label: 'Units', color: 'var(--accent)' }]} format={(v) => num(v)} /></Card>
          </div>
          <Card padded={false}>
            <div className="p-5 pb-0"><CardHeader title="Slow movers" subtitle="In stock but no sales or dispensing in 60 days" /></div>
            {inv.data.slowMovers.length === 0 ? <EmptyState title="No slow movers" /> : (
              <Table><THead><tr><TH>Product</TH><TH align="right">On hand</TH><TH align="right">Value</TH></tr></THead>
                <tbody>{inv.data.slowMovers.map((s) => <TR key={s.name}><TD>{s.name}</TD><TD align="right">{s.onHand}</TD><TD align="right">{money(s.value)}</TD></TR>)}</tbody>
              </Table>
            )}
          </Card>
        </div>
      )}
    </PageBody>
  );
}
