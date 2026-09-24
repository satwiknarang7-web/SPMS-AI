'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Boxes, DollarSign, Percent, ShoppingBag, Truck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageBody } from '@/components/layout/AppShell';
import { Badge, Card, CardHeader, EmptyState, Loading, PageHeader, Stat, Table, TD, TH, THead, TR } from '@/components/ui';
import { BarsChart, DonutChart, TrendChart } from '@/components/ui/charts';
import { useSession } from '@/features/auth/session';
import type { SalesReport } from '@/features/office/reports/OfficeReports';
import { api } from '@/lib/api';
import { money, moneyCompact, num, pct } from '@/lib/format';

export interface Dashboard {
  stockValue: number;
  retailValue: number;
  skuCount: number;
  lowStockCount: number;
  lowStock: { productId: string; name: string; onHand: number; reorderPoint: number }[];
  openOrders: number;
  sales7: { total: number; count: number };
  salesToday: { total: number; count: number };
  retailMarginPct: number;
  topProducts: { name: string; revenue: number; units: number }[];
}

export function OfficeDashboard() {
  const router = useRouter();
  const { store } = useSession();
  const { data, isLoading } = useQuery({ queryKey: ['office', 'dashboard'], queryFn: () => api.get<Dashboard>('/office/dashboard') });
  const sales = useQuery({ queryKey: ['office', 'reports', 'sales', 30], queryFn: () => api.get<SalesReport>('/office/reports/sales', { days: 30 }) });
  return (
    <PageBody>
      <PageHeader eyebrow="Store operations" title="Store performance" subtitle={store?.name} />
      {isLoading || !data ? <Loading /> : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Sales today" value={money(data.salesToday.total)} icon={<DollarSign />} hint={`${data.salesToday.count} transactions`} />
            <Stat label="Last 7 days" value={moneyCompact(data.sales7.total)} icon={<ShoppingBag />} hint={`${num(data.sales7.count)} transactions`} />
            <Stat label="Retail margin (7 days)" value={pct(data.retailMarginPct)} icon={<Percent />} tone="green" />
            <Stat label="Stock on hand (cost)" value={moneyCompact(data.stockValue)} icon={<Boxes />} hint={`${num(data.skuCount)} SKUs · retail ${moneyCompact(data.retailValue)}`} />
          </div>
          {sales.data && (
            <Card>
              <CardHeader title="Revenue — last 30 days" subtitle="Retail and prescription takings through the register" />
              <TrendChart data={sales.data.byDay} series={[{ key: 'revenue', label: 'Revenue', color: 'var(--accent)' }]} />
            </Card>
          )}
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2" padded={false}>
              <div className="p-5 pb-0"><CardHeader title="Top sellers this week" /></div>
              <Table>
                <THead><tr><TH>Product</TH><TH align="right">Units</TH><TH align="right">Revenue</TH></tr></THead>
                <tbody>
                  {data.topProducts.map((p) => (
                    <TR key={p.name}><TD className="text-ink-900">{p.name}</TD><TD align="right">{num(p.units)}</TD><TD align="right" className="font-medium">{money(p.revenue)}</TD></TR>
                  ))}
                </tbody>
              </Table>
            </Card>
            <Card>
              <CardHeader title="Needs attention" icon={<AlertTriangle />} />
              <div className="space-y-3">
                <Link href="/office/inventory?tab=reorder" className="flex items-center justify-between rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
                  <span className="text-sm font-medium text-amber-900">Below reorder point</span>
                  <Badge tone="amber">{data.lowStockCount}</Badge>
                </Link>
                <Link href="/office/orders" className="flex items-center justify-between rounded-xl bg-sky-50 p-3 ring-1 ring-sky-200">
                  <span className="flex items-center gap-2 text-sm font-medium text-sky-900"><Truck className="size-4" /> Orders awaiting delivery</span>
                  <Badge tone="blue">{data.openOrders}</Badge>
                </Link>
                {data.lowStock.length === 0 ? <EmptyState title="Stock levels look healthy" /> : (
                  <ul className="divide-y divide-ink-100 text-sm">
                    {data.lowStock.map((l) => (
                      <li key={l.productId} className="flex cursor-pointer justify-between py-2 hover:text-[var(--accent)]" onClick={() => router.push(`/office/products/${l.productId}`)}>
                        <span className="truncate pr-2">{l.name}</span>
                        <span className={l.onHand <= 0 ? 'font-semibold text-rose-600' : 'text-ink-600'}>{l.onHand} / {l.reorderPoint}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          </div>
          {sales.data && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card><CardHeader title="Sales by category (30 days)" /><DonutChart data={sales.data.byCategory.map((c) => ({ name: c.category, value: c.revenue }))} /></Card>
              <Card><CardHeader title="Gross profit by category" /><BarsChart data={sales.data.byCategory.slice(0, 8)} xKey="category" layout="vertical" series={[{ key: 'grossProfit', label: 'Gross profit', color: 'var(--accent)' }]} /></Card>
            </div>
          )}
        </div>
      )}
    </PageBody>
  );
}
