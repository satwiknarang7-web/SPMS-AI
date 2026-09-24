'use client';

import { useQuery } from '@tanstack/react-query';
import { RotateCcw, Save, Tags } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageBody } from '@/components/layout/AppShell';
import { Alert, Badge, Button, Card, Dialog, EmptyState, Field, Input, Loading, PageHeader, SearchInput, Select, Table, TD, TH, THead, TR } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { useCategories } from '@/features/shared/catalogue';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dollars, money, parseMoney, pct } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface PriceRow { id: string; sku: string; name: string; category: string; costPrice: number; retailPrice: number; masterRetailPrice: number; storeOverride: boolean; marginPct: number }

export function PricingReview() {
  const { can } = useSession();
  const cats = useCategories();
  const [filter, setFilter] = useState<'all' | 'low-margin' | 'differs-from-hq'>('all');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [bulk, setBulk] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['office', 'pricing', filter, category, q], queryFn: () => api.get<PriceRow[]>('/office/pricing/review', { filter, category, q, threshold: 25 }) });

  const changes = useMemo(
    () => Object.entries(edits).map(([productId, v]) => ({ productId, retailPrice: parseMoney(v) })).filter((c) => { const row = data?.find((r) => r.id === c.productId); return row && c.retailPrice !== row.retailPrice; }),
    [edits, data],
  );
  const invalid = changes.filter((c) => c.retailPrice == null || c.retailPrice <= 0);
  const applyBulk = () => {
    const p = Number.parseFloat(bulk);
    if (!Number.isFinite(p) || !data) return;
    setEdits(Object.fromEntries(data.map((r) => [r.id, dollars(Math.round((r.retailPrice * (1 + p / 100)) / 10) * 10 - 1)])));
  };
  const save = useAction(() => api.post<{ updated: number }>('/office/pricing/review', { reason, changes }), {
    success: (r) => `${r.updated} price(s) updated — now live at POS`, invalidate: [['office'], ['pos']], onSuccess: () => { setEdits({}); setConfirming(false); setReason(''); },
  });

  return (
    <PageBody wide>
      <PageHeader title="Pricing review" subtitle="Bulk, audited store price changes with zero-price protection. The price set here is the price charged at POS." actions={can('office.pricing.write') && changes.length > 0 && (
        <>
          <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => setEdits({})}>Discard</Button>
          <Button variant="primary" icon={<Save className="size-4" />} disabled={invalid.length > 0} onClick={() => setConfirming(true)}>Review {changes.length} change(s)</Button>
        </>
      )} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Product or SKU" className="w-64" />
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-56"><option value="">All categories</option>{cats.data?.filter((c) => c.category !== 'Prescription').map((c) => <option key={c.category} value={c.category}>{c.category}</option>)}</Select>
        <Select value={filter} onChange={(e) => setFilter(e.target.value as 'all')} className="w-56"><option value="all">All items</option><option value="low-margin">Margin below 25%</option><option value="differs-from-hq">Differs from HQ price</option></Select>
        {can('office.pricing.write') && (
          <div className="ml-auto flex items-end gap-2">
            <Field label="Bulk change %"><Input value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder="e.g. 3.5" className="w-28" /></Field>
            <Button onClick={applyBulk} disabled={!bulk}>Apply to list</Button>
          </div>
        )}
      </div>
      {invalid.length > 0 && <Alert tone="red" className="mb-4">Zero or invalid prices are blocked — fix {invalid.length} highlighted item(s).</Alert>}
      <Card padded={false}>
        {isLoading ? <Loading /> : !data?.length ? <EmptyState icon={<Tags />} title="No items match" /> : (
          <Table>
            <THead><tr><TH>Product</TH><TH>Category</TH><TH align="right">Cost</TH><TH align="right">HQ price</TH><TH align="right">Store price</TH><TH align="right">New price</TH><TH align="right">Margin</TH></tr></THead>
            <tbody>
              {data.map((r) => {
                const edited = edits[r.id];
                const next = edited != null ? parseMoney(edited) : null;
                const price = next ?? r.retailPrice;
                const m = price > 0 ? ((price - r.costPrice) / price) * 100 : 0;
                const bad = edited != null && (next == null || next <= 0);
                return (
                  <TR key={r.id} active={edited != null && next !== r.retailPrice}>
                    <TD className="font-medium text-ink-900">{r.name}<span className="block font-mono text-xs text-ink-400">{r.sku}</span></TD>
                    <TD className="text-ink-600">{r.category}</TD>
                    <TD align="right">{money(r.costPrice)}</TD>
                    <TD align="right" className="text-ink-500">{money(r.masterRetailPrice)}</TD>
                    <TD align="right">{money(r.retailPrice)}{r.storeOverride && r.retailPrice !== r.masterRetailPrice && <Badge tone="amber" className="ml-1">Local</Badge>}</TD>
                    <TD align="right">
                      <Input disabled={!can('office.pricing.write')} value={edited ?? dollars(r.retailPrice)} onChange={(e) => setEdits((x) => ({ ...x, [r.id]: e.target.value }))} className={cn('ml-auto w-24 text-right', bad && '[&]:ring-2 [&]:ring-rose-500')} />
                    </TD>
                    <TD align="right" className={cn('font-medium', m < 0 ? 'text-rose-600' : m < 25 ? 'text-amber-700' : 'text-emerald-700')}>{pct(m)}</TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <Dialog open={confirming} onClose={() => setConfirming(false)} title={`Apply ${changes.length} price change(s)?`} description="Changes are recorded in price history and the audit log, and take effect at POS immediately."
        footer={<><Button variant="ghost" onClick={() => setConfirming(false)}>Back</Button><Button variant="primary" disabled={reason.length < 3} loading={save.isPending} onClick={() => save.mutate(undefined)}>Apply prices</Button></>}>
        <Field label="Reason for review" required><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Quarterly competitor price check" /></Field>
        {changes.some((c) => { const r = data?.find((x) => x.id === c.productId); return r && (c.retailPrice ?? 0) < r.costPrice; }) && <Alert tone="amber" className="mt-3">Some new prices are below cost.</Alert>}
      </Dialog>
    </PageBody>
  );
}
