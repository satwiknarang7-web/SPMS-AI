'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarClock, RefreshCw, RotateCcw, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { PageBody } from '@/components/layout/AppShell';
import { Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, Loading, PageHeader, ProgressBar, Select, StatusBadge, Table, TD, TH, THead, TR } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { api } from '@/lib/api';
import { dateTime, relative } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface Publication { id: string; kind: string; title: string; status: string; effectiveAt: string; activatedAt: string | null; createdAt: string; createdBy: string | null; rollbackOfId: string | null; scheduled: boolean; counts: Record<string, number>; total: number }

export interface PublicationDetail { id: string; kind: string; title: string; status: string; effectiveAt: string; payload: unknown; targets: { id: string; storeId: string; status: string; attempts: number; lastAttemptAt: string | null; appliedAt: string | null; error: string | null; store: { code: string; name: string; online: boolean; status: string } | null }[] }

export const KIND_LABEL: Record<string, string> = { RETAIL_PRICE: 'Retail prices', DISPENSE_PRICING: 'Dispense pricing', PROMOTION: 'Promotion', DRUG_CONFIG: 'Drug config', PRICE_FILE: 'Price file', ROLLBACK: 'Rollback' };

export function SyncPage() {
  const { can } = useSession();
  const [kind, setKind] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['hq', 'publications', kind], queryFn: () => api.get<Publication[]>('/hq/sync/publications', { kind }), refetchInterval: 10_000 });
  const run = useAction(() => api.post<{ applied: number; deferred: number; activated: number }>('/hq/sync/run'), { success: (r) => `Sync pass: ${r.applied} applied, ${r.deferred} waiting, ${r.activated} activated`, invalidate: [['hq']] });
  return (
    <PageBody wide>
      <PageHeader title="Publishing & sync" subtitle="Every configuration change HQ distributes, with per-store delivery status. Offline stores are queued and retried automatically."
        actions={<>
          <Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-48"><option value="">All changes</option>{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          {can('hq.publish') && <Button icon={<RefreshCw className="size-4" />} loading={run.isPending} onClick={() => run.mutate(undefined)}>Run sync now</Button>}
        </>} />
      <Card padded={false}>
        {isLoading ? <Loading /> : !data?.length ? <EmptyState title="Nothing published yet" /> : (
          <Table>
            <THead><tr><TH>Change</TH><TH>Type</TH><TH>By</TH><TH>Effective</TH><TH>Delivery</TH><TH>Status</TH></tr></THead>
            <tbody>
              {data.map((p) => {
                const applied = p.counts.APPLIED ?? 0;
                return (
                  <TR key={p.id} onClick={() => setOpen(p.id)}>
                    <TD className="font-medium text-ink-900">{p.title}</TD>
                    <TD><Badge tone={p.kind === 'ROLLBACK' ? 'red' : 'blue'}>{KIND_LABEL[p.kind] ?? p.kind}</Badge></TD>
                    <TD className="text-ink-600">{p.createdBy ?? 'System'}<span className="block text-xs text-ink-400">{relative(p.createdAt)}</span></TD>
                    <TD className="text-ink-500">{p.scheduled ? <span className="flex items-center gap-1 text-tertiary-600"><CalendarClock className="size-3.5" />{dateTime(p.effectiveAt)}</span> : dateTime(p.effectiveAt)}</TD>
                    <TD className="w-52">
                      <ProgressBar value={applied} max={p.total} tone={p.counts.FAILED ? '#e11d48' : undefined} />
                      <span className="text-xs text-ink-500">{applied}/{p.total} applied{p.counts.QUEUED ? ` · ${p.counts.QUEUED} queued` : ''}{p.counts.FAILED ? ` · ${p.counts.FAILED} failed` : ''}{p.counts.CANCELLED ? ` · ${p.counts.CANCELLED} withdrawn` : ''}</span>
                    </TD>
                    <TD><StatusBadge status={p.scheduled && p.status === 'PUBLISHED' ? 'SCHEDULED' : p.status} /></TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <PublicationDrawer id={open} onClose={() => setOpen(null)} />
    </PageBody>
  );
}

export function PublicationDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { can } = useSession();
  const [confirm, setConfirm] = useState(false);
  const { data } = useQuery({ queryKey: ['hq', 'publication', id], queryFn: () => api.get<PublicationDetail>(`/hq/sync/publications/${id}`), enabled: !!id, refetchInterval: 5000 });
  const republish = useAction((storeId: string) => api.post(`/hq/sync/publications/${id}/republish`, { storeId }), { success: 'Re-queued for the store', invalidate: [['hq']] });
  const rollback = useAction(() => api.post<{ storesToRestore: number }>(`/hq/sync/publications/${id}/rollback`), { success: (r) => `Rolled back — restoring ${r.storesToRestore} store(s)`, invalidate: [['hq']], onSuccess: () => setConfirm(false) });
  return (
    <Drawer open={!!id} onClose={onClose} title={data?.title ?? 'Publication'} width="max-w-2xl"
      footer={data && data.status === 'PUBLISHED' && data.kind !== 'ROLLBACK' && can('hq.publish') && <Button variant="danger" icon={<Undo2 className="size-4" />} onClick={() => setConfirm(true)}>Roll back this change</Button>}>
      {!data ? <Loading /> : (
        <>
          <div className="mb-4 flex flex-wrap gap-2"><Badge tone="blue">{KIND_LABEL[data.kind]}</Badge><StatusBadge status={data.status} /><Badge>Effective {dateTime(data.effectiveAt)}</Badge></div>
          <Table>
            <THead><tr><TH>Store</TH><TH>Delivery</TH><TH>Attempts</TH><TH>Detail</TH><TH /></tr></THead>
            <tbody>
              {data.targets.map((t) => (
                <TR key={t.id}>
                  <TD><span className="font-medium text-ink-900">{t.store?.code}</span><span className="block text-xs text-ink-500">{t.store?.name}</span></TD>
                  <TD><StatusBadge status={t.status} label={t.status === 'CANCELLED' ? 'Withdrawn' : undefined} /></TD>
                  <TD>{t.attempts}</TD>
                  <TD className="text-xs text-ink-500">{t.appliedAt ? `Applied ${dateTime(t.appliedAt)}` : t.error ?? (t.lastAttemptAt ? `Last try ${relative(t.lastAttemptAt)}` : 'Waiting for effective date')}</TD>
                  <TD align="right">{can('hq.publish') && data.status === 'PUBLISHED' && <Button size="xs" icon={<RotateCcw className="size-3" />} loading={republish.isPending} onClick={() => republish.mutate(t.storeId)}>Re-publish</Button>}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
          <details className="mt-5 rounded-xl bg-ink-50 p-3 text-xs">
            <summary className="cursor-pointer font-medium text-ink-700">Payload</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-ink-600">{JSON.stringify(data.payload, null, 2)}</pre>
          </details>
        </>
      )}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} tone="danger" confirmLabel="Roll back" loading={rollback.isPending} title="Roll back this change?"
        description="Central state is restored now. Stores that already applied it are restored to their exact previous values; stores still waiting simply won't receive it." onConfirm={() => rollback.mutate(undefined)} />
    </Drawer>
  );
}
