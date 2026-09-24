'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ScanLine } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { PageBody } from '@/components/layout/AppShell';
import { Badge, Button, Card, ConfirmDialog, Input, Loading, NotFound, PageHeader, SearchInput, Select, Stat, StatusBadge, Table, Tabs, TD, TH, THead, TR } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { Stocktakes } from '@/features/office/stocktake/Stocktakes';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { money } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface StocktakeDetailData { id: string; name: string; status: string; category: string | null; counts: { id: string; productId: string; systemQty: number; countedQty: number | null; variance: number | null; varianceValue: number | null; reasonCode: string | null; product: { id: string; name: string; sku: string; barcode: string | null; category: string } | null }[] }

export const REASONS = ['UNEXPLAINED', 'DAMAGED', 'EXPIRED', 'THEFT', 'SUPPLIER_SHORT', 'COUNT_ERROR'];

export function StocktakeDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const [filter, setFilter] = useState<'all' | 'uncounted' | 'variance'>('all');
  const [q, setQ] = useState('');
  const [scan, setScan] = useState('');
  const [local, setLocal] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [posting, setPosting] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const { data: t, isLoading, refetch } = useQuery({ queryKey: ['office', 'stocktake', id], queryFn: () => api.get<StocktakeDetailData>(`/office/stocktakes/${id}`) });

  const saveCounts = async (counts: { productId: string; quantity: number }[], mode: 'set' | 'add') => {
    try {
      await api.put(`/office/stocktakes/${id}/counts`, { mode, counts });
      await refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const onScan = async () => {
    const row = t?.counts.find((c) => c.product?.barcode === scan.trim());
    if (!row) toast.error('Barcode not in this stocktake scope');
    else {
      await saveCounts([{ productId: row.productId, quantity: 1 }], 'add');
      toast.success(`+1 ${row.product?.name}`, { duration: 1200 });
    }
    setScan('');
    scanRef.current?.focus();
  };
  const review = useAction(() => api.post(`/office/stocktakes/${id}/review`), { success: 'Counting closed — review variances', invalidate: [['office']] });
  const post = useAction(() => api.post<{ adjusted: number; varianceValue: number }>(`/office/stocktakes/${id}/post`, { reasonCodes: reasons }), {
    success: (r) => `Posted ${r.adjusted} adjustment(s), value ${money(r.varianceValue)}`, invalidate: [['office']], onSuccess: () => setPosting(false),
  });

  const rows = useMemo(() => (t?.counts ?? []).filter((c) => (filter === 'uncounted' ? c.countedQty == null : filter === 'variance' ? c.variance != null && c.variance !== 0 : true)).filter((c) => !q || c.product?.name.toLowerCase().includes(q.toLowerCase())), [t, filter, q]);
  if (isLoading) return <Loading />;
  if (!t) return <NotFound what="stocktake" />;
  const counted = t.counts.filter((c) => c.countedQty != null).length;
  const value = t.counts.reduce((s, c) => s + (c.varianceValue ?? 0), 0);
  const editable = t.status === 'COUNTING' && can('office.stocktake.write');

  return (
    <PageBody wide>
      <PageHeader back={<Link href="/office/stocktake" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800"><ArrowLeft className="size-4" /> Stocktakes</Link>}
        title={<span className="flex items-center gap-3">{t.name}<StatusBadge status={t.status} /></span>} subtitle={t.category ?? 'Full store'}
        actions={can('office.stocktake.write') && <>
          {t.status === 'COUNTING' && <Button onClick={() => review.mutate(undefined)} loading={review.isPending}>Close counting</Button>}
          {['COUNTING', 'REVIEW'].includes(t.status) && <Button variant="primary" onClick={() => setPosting(true)}>Post variances</Button>}
        </>} />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Stat label="Counted" value={`${counted} / ${t.counts.length}`} />
        <Stat label="Lines with variance" value={t.counts.filter((c) => c.variance).length} tone="amber" />
        <Stat label="Variance value (cost)" value={money(value)} tone={value < 0 ? 'red' : 'green'} />
      </div>
      {editable && (
        <Card className="mb-5">
          <form onSubmit={(e) => { e.preventDefault(); void onScan(); }} className="flex items-center gap-3">
            <Input ref={scanRef} icon={<ScanLine />} value={scan} onChange={(e) => setScan(e.target.value)} placeholder="Scan items to count — each scan adds one (supports multiple counters)" className="flex-1" autoFocus />
            <Button type="submit">Add</Button>
          </form>
        </Card>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={filter} onChange={setFilter} tabs={[{ value: 'all', label: 'All', count: t.counts.length }, { value: 'uncounted', label: 'Not counted', count: t.counts.length - counted }, { value: 'variance', label: 'Variances', count: t.counts.filter((c) => c.variance).length }]} />
        <SearchInput value={q} onChange={setQ} placeholder="Find product" className="w-64" />
      </div>
      <Card padded={false}>
        <Table>
          <THead><tr><TH>Product</TH><TH align="right">System</TH><TH align="right">Counted</TH><TH align="right">Variance</TH><TH align="right">Value</TH><TH>Reason</TH></tr></THead>
          <tbody>
            {rows.map((c) => (
              <TR key={c.id}>
                <TD className="text-ink-900">{c.product?.name}<span className="block font-mono text-xs text-ink-400">{c.product?.sku}</span></TD>
                <TD align="right">{c.systemQty}</TD>
                <TD align="right">
                  {editable ? (
                    <Input type="number" min={0} value={local[c.productId] ?? (c.countedQty ?? '')} onChange={(e) => setLocal((l) => ({ ...l, [c.productId]: e.target.value }))}
                      onBlur={() => { const v = local[c.productId]; if (v !== undefined && v !== '' && Number(v) !== c.countedQty) void saveCounts([{ productId: c.productId, quantity: Number(v) }], 'set'); }}
                      className="ml-auto w-20 text-right" />
                  ) : c.countedQty ?? '—'}
                </TD>
                <TD align="right" className={cn('font-semibold', (c.variance ?? 0) < 0 ? 'text-rose-600' : (c.variance ?? 0) > 0 && 'text-emerald-700')}>{c.variance == null ? '—' : `${c.variance > 0 ? '+' : ''}${c.variance}`}</TD>
                <TD align="right">{c.varianceValue ? money(c.varianceValue) : ''}</TD>
                <TD>
                  {c.variance ? (t.status === 'POSTED' ? <Badge>{c.reasonCode?.toLowerCase().replace('_', ' ')}</Badge> : (
                    <Select value={reasons[c.productId] ?? 'UNEXPLAINED'} onChange={(e) => setReasons((r) => ({ ...r, [c.productId]: e.target.value }))} className="w-44">{REASONS.map((r) => <option key={r} value={r}>{r.toLowerCase().replace('_', ' ')}</option>)}</Select>
                  )) : null}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>
      <ConfirmDialog open={posting} onClose={() => setPosting(false)} title="Post stocktake variances?" loading={post.isPending} confirmLabel="Post adjustments"
        description={`${t.counts.filter((c) => c.variance).length} line(s) will be adjusted (${money(value)} at cost). Uncounted items are left unchanged. Variances are reported to HQ.`} onConfirm={() => post.mutate(undefined)} />
    </PageBody>
  );
}
