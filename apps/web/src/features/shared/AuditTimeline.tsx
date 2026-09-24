'use client';

import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useState } from 'react';
import { PageBody } from '@/components/layout/AppShell';
import { Badge, Card, Dialog, EmptyState, Loading, PageHeader, SearchInput, Table, TD, TH, THead, TR } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';

export interface AuditEvent { id: string; action: string; summary: string; userName: string | null; role: string | null; entityType: string; before: string | null; after: string | null; createdAt: string; hash: string }

export function AuditTimeline({ module, title, subtitle }: { module?: string; title: string; subtitle: string }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<AuditEvent | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['audit', module, q], queryFn: () => api.get<AuditEvent[]>('/platform/audit', { module, search: q, limit: 200 }) });
  return (
    <PageBody>
      <PageHeader title={title} subtitle={subtitle} />
      <SearchInput value={q} onChange={setQ} placeholder="Search changes, people or actions" className="mb-4 max-w-md" />
      <Card padded={false}>
        {isLoading ? <Loading /> : !data?.length ? <EmptyState icon={<History />} title="No events" /> : (
          <Table>
            <THead><tr><TH>When</TH><TH>Who</TH><TH>Action</TH><TH>Summary</TH><TH>Hash</TH></tr></THead>
            <tbody>
              {data.map((e) => (
                <TR key={e.id} onClick={() => setOpen(e)}>
                  <TD className="whitespace-nowrap text-ink-500">{dateTime(e.createdAt)}</TD>
                  <TD className="text-ink-800">{e.userName ?? 'System'}</TD>
                  <TD><Badge>{e.action}</Badge></TD>
                  <TD className="max-w-xl text-ink-700">{e.summary}</TD>
                  <TD mono className="text-ink-400">{e.hash.slice(0, 10)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Dialog open={!!open} onClose={() => setOpen(null)} size="lg" title={open?.summary ?? ''} description={open && `${open.userName ?? 'System'} · ${dateTime(open.createdAt)} · ${open.action}`}>
        {open && (
          <div className="grid gap-4 md:grid-cols-2">
            <div><div className="mb-1 text-xs font-semibold text-ink-500 uppercase">Before</div><pre className="max-h-80 overflow-auto rounded-lg bg-rose-50 p-3 text-xs whitespace-pre-wrap text-rose-900">{open.before ? JSON.stringify(JSON.parse(open.before), null, 2) : '—'}</pre></div>
            <div><div className="mb-1 text-xs font-semibold text-ink-500 uppercase">After</div><pre className="max-h-80 overflow-auto rounded-lg bg-emerald-50 p-3 text-xs whitespace-pre-wrap text-emerald-900">{open.after ? JSON.stringify(JSON.parse(open.after), null, 2) : '—'}</pre></div>
            <div className="md:col-span-2 font-mono text-[11px] break-all text-ink-400">SHA-256 {open.hash}</div>
          </div>
        )}
      </Dialog>
    </PageBody>
  );
}
