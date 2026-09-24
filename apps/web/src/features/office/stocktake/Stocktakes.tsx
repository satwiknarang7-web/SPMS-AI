'use client';

import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, PlusCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageBody } from '@/components/layout/AppShell';
import { Button, Card, Dialog, EmptyState, Field, Input, Loading, PageHeader, ProgressBar, Select, StatusBadge, Table, TD, TH, THead, TR } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { useCategories } from '@/features/shared/catalogue';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dateTime } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface StocktakeRow { id: string; name: string; scope: string; category: string | null; status: string; createdAt: string; postedAt: string | null; items: number; counted: number; varianceUnits: number }

export function Stocktakes() {
  const router = useRouter();
  const { can } = useSession();
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['office', 'stocktakes'], queryFn: () => api.get<StocktakeRow[]>('/office/stocktakes') });
  return (
    <PageBody>
      <PageHeader title="Stocktake" subtitle="Count while trading, after hours, or across multiple sessions" actions={can('office.stocktake.write') && <Button variant="primary" icon={<PlusCircle className="size-4" />} onClick={() => setCreating(true)}>New stocktake</Button>} />
      <Card padded={false}>
        {isLoading ? <Loading /> : !data?.length ? <EmptyState icon={<ClipboardCheck />} title="No stocktakes yet" description="Start a full or category stocktake to reconcile physical stock." /> : (
          <Table>
            <THead><tr><TH>Name</TH><TH>Scope</TH><TH>Started</TH><TH>Progress</TH><TH align="right">Variance (units)</TH><TH>Status</TH></tr></THead>
            <tbody>
              {data.map((t) => (
                <TR key={t.id} onClick={() => router.push(`/office/stocktake/${t.id}`)}>
                  <TD className="font-medium text-ink-900">{t.name}</TD>
                  <TD>{t.category ?? 'Full store'}</TD>
                  <TD className="text-ink-500">{dateTime(t.createdAt)}</TD>
                  <TD className="w-48"><ProgressBar value={t.counted} max={t.items} /><span className="text-xs text-ink-500">{t.counted} / {t.items} counted</span></TD>
                  <TD align="right" className={cn(t.varianceUnits < 0 ? 'text-rose-600' : t.varianceUnits > 0 && 'text-emerald-700')}>{t.varianceUnits > 0 ? '+' : ''}{t.varianceUnits}</TD>
                  <TD><StatusBadge status={t.status} /></TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <NewStocktakeDialog open={creating} onClose={() => setCreating(false)} />
    </PageBody>
  );
}

export function NewStocktakeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const cats = useCategories();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  useEffect(() => { if (open) { setName(`Stocktake ${new Date().toLocaleDateString('en-AU')}`); setCategory(''); } }, [open]);
  const save = useAction(() => api.post<{ id: string }>('/office/stocktakes', { name, category: category || null }), { success: 'Stocktake started — system quantities snapshotted', invalidate: [['office', 'stocktakes']], onSuccess: (t) => { onClose(); router.push(`/office/stocktake/${t.id}`); } });
  return (
    <Dialog open={open} onClose={onClose} title="New stocktake" description="System quantities are snapshotted now. Sales and dispensing during the count are accounted for when variances post."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Start counting</Button></>}>
      <div className="grid gap-4">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Scope"><Select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Full store</option>{cats.data?.map((c) => <option key={c.category} value={c.category}>{c.category} ({c.count})</option>)}</Select></Field>
      </div>
    </Dialog>
  );
}
