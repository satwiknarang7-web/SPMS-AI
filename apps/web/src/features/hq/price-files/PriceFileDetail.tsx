'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageBody } from '@/components/layout/AppShell';
import { Alert, Button, Card, ConfirmDialog, Loading, NotFound, PageHeader, Stat, StatusBadge, Table, Tabs, TD, TH, THead, TR } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dateTime, money } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface PriceFileDetailData { id: string; fileName: string; status: string; createdAt: string; supplier: { name: string }; summary: Record<string, number>; lines: { id: string; rowNo: number; barcode: string; description: string; oldCost: number | null; newCost: number | null; oldRetail: number | null; newRetail: number | null; changePct: number | null; issue: string; message: string | null; accepted: boolean; product: { name: string; sku: string } | null }[] }

export function PriceFileDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const [filter, setFilter] = useState('ALL');
  const [rejecting, setRejecting] = useState(false);
  const { data: f, isLoading, refetch } = useQuery({ queryKey: ['hq', 'pricefile', id], queryFn: () => api.get<PriceFileDetailData>(`/hq/pricefiles/${id}`) });
  const toggle = useAction(({ lineId, accepted }: { lineId: string; accepted: boolean }) => api.patch(`/hq/pricefiles/${id}/lines/${lineId}`, { accepted }), { onSuccess: () => void refetch() });
  const approve = useAction(() => api.post(`/hq/pricefiles/${id}/approve`), { success: 'Approved — prices are being published to stores', invalidate: [['hq']] });
  const reject = useAction((reason: string) => api.post(`/hq/pricefiles/${id}/reject`, { reason }), { success: 'Price file rejected', invalidate: [['hq']], onSuccess: () => setRejecting(false) });
  const lines = useMemo(() => (f?.lines ?? []).filter((l) => filter === 'ALL' || l.issue === filter), [f, filter]);
  if (isLoading) return <Loading />;
  if (!f) return <NotFound what="price file" />;
  const editable = f.status === 'VALIDATED' && can('hq.pricefiles.write');
  const accepted = f.lines.filter((l) => l.accepted).length;
  return (
    <PageBody wide>
      <PageHeader back={<Link href="/hq/price-files" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800"><ArrowLeft className="size-4" /> Price files</Link>}
        title={<span className="flex items-center gap-3">{f.fileName}<StatusBadge status={f.status} label={f.status === 'VALIDATED' ? 'Awaiting approval' : undefined} /></span>} subtitle={`${f.supplier.name} · uploaded ${dateTime(f.createdAt)}`}
        actions={editable && <><Button variant="ghost" icon={<XCircle className="size-4" />} onClick={() => setRejecting(true)}>Reject</Button>{can('hq.publish') && <Button variant="primary" icon={<CheckCircle2 className="size-4" />} disabled={!accepted} loading={approve.isPending} onClick={() => approve.mutate(undefined)}>Approve {accepted} price(s)</Button>}</>} />
      <div className="mb-5 grid gap-4 sm:grid-cols-4">
        <Stat label="Matched, within threshold" value={f.summary.OK ?? 0} tone="green" />
        <Stat label="Outliers to review" value={f.summary.OUTLIER ?? 0} tone="amber" icon={<AlertTriangle />} />
        <Stat label="Unmatched" value={f.summary.UNMATCHED ?? 0} tone="red" />
        <Stat label="Errors" value={f.summary.ERROR ?? 0} tone="red" />
      </div>
      {editable && (f.summary.OUTLIER ?? 0) > 0 && <Alert tone="amber" className="mb-4">Outlier rows are excluded until you tick them. Unmatched and error rows can't be published.</Alert>}
      <Tabs className="mb-4" value={filter} onChange={setFilter} tabs={['ALL', 'OK', 'OUTLIER', 'UNMATCHED', 'ERROR'].map((v) => ({ value: v, label: v === 'ALL' ? 'All' : v.toLowerCase(), count: v === 'ALL' ? f.lines.length : f.summary[v] ?? 0 }))} />
      <Card padded={false}>
        <Table>
          <THead><tr><TH>Row</TH><TH>Item</TH><TH align="right">Cost</TH><TH align="right">Change</TH><TH align="right">Retail</TH><TH>Result</TH><TH align="center">Publish</TH></tr></THead>
          <tbody>
            {lines.map((l) => (
              <TR key={l.id}>
                <TD mono>{l.rowNo}</TD>
                <TD><span className="text-ink-900">{l.product?.name ?? l.description}</span><span className="block font-mono text-xs text-ink-400">{l.barcode}</span></TD>
                <TD align="right">{l.oldCost != null && <span className="text-ink-400">{money(l.oldCost)} → </span>}{money(l.newCost)}</TD>
                <TD align="right" className={cn(l.changePct != null && Math.abs(l.changePct) > 20 && 'font-semibold text-amber-700')}>{l.changePct != null ? `${l.changePct > 0 ? '+' : ''}${l.changePct.toFixed(1)}%` : '—'}</TD>
                <TD align="right">{l.oldRetail != null && <span className="text-ink-400">{money(l.oldRetail)} → </span>}{money(l.newRetail)}</TD>
                <TD><StatusBadge status={l.issue} />{l.message && <span className="block text-xs text-ink-500">{l.message}</span>}</TD>
                <TD align="center"><input type="checkbox" className="size-4 accent-[var(--accent)]" checked={l.accepted} disabled={!editable || !['OK', 'OUTLIER'].includes(l.issue)} onChange={(e) => toggle.mutate({ lineId: l.id, accepted: e.target.checked })} /></TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>
      <ConfirmDialog open={rejecting} onClose={() => setRejecting(false)} title="Reject this price file?" requireReason tone="danger" confirmLabel="Reject" loading={reject.isPending} onConfirm={(r) => reject.mutate(r)} />
    </PageBody>
  );
}
