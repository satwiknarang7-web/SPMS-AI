'use client';

import { useQuery } from '@tanstack/react-query';
import { Megaphone, PlusCircle, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageBody } from '@/components/layout/AppShell';
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, Field, Input, Loading, PageHeader, SearchInput, Select, StatusBadge } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { useStores } from '@/features/hq/shared/stores';
import { api } from '@/lib/api';
import { date, money, parseMoney } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface Promotion { id: string; name: string; type: string; value: number; startsAt: string; endsAt: string; status: string; publicationId: string | null; productIds: string[]; storeIds: string[]; products: { id: string; name: string }[]; delivery: { applied: number; total: number } | null }

export function Promotions() {
  const { can } = useSession();
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['hq', 'promotions'], queryFn: () => api.get<Promotion[]>('/hq/promotions') });
  const publish = useAction((id: string) => api.post(`/hq/promotions/${id}/publish`), { success: 'Promotion published to participating stores', invalidate: [['hq']] });
  const now = Date.now();
  return (
    <PageBody wide>
      <PageHeader title="Promotions" subtitle="Group promotions with dates, participating stores and a discount mechanism — applied automatically at POS" actions={can('hq.promotions.write') && <Button variant="primary" icon={<PlusCircle className="size-4" />} onClick={() => setCreating(true)}>New promotion</Button>} />
      {isLoading ? <Loading /> : !data?.length ? <Card><EmptyState icon={<Megaphone />} title="No promotions" /></Card> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((p) => {
            const live = p.status === 'PUBLISHED' && new Date(p.startsAt).getTime() <= now && new Date(p.endsAt).getTime() >= now;
            return (
              <Card key={p.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-ink-900">{p.name}</div>
                  {live ? <Badge tone="green" dot>Live</Badge> : p.publicationId && p.status === 'DRAFT' ? <StatusBadge status="QUEUED" label="Delivering" /> : <StatusBadge status={new Date(p.endsAt).getTime() < now && p.status === 'PUBLISHED' ? 'CLOSED' : p.status} label={new Date(p.endsAt).getTime() < now && p.status === 'PUBLISHED' ? 'Ended' : undefined} />}
                </div>
                <div className="mt-3 text-3xl font-bold tracking-tight text-[var(--accent)]">{p.type === 'PERCENT_OFF' ? `${p.value}% off` : p.type === 'AMOUNT_OFF' ? `${money(p.value)} off` : `Now ${money(p.value)}`}</div>
                <div className="mt-2 text-sm text-ink-500">{date(p.startsAt)} – {date(p.endsAt)} · {p.storeIds.length} store(s){p.delivery && ` · applied at ${p.delivery.applied}/${p.delivery.total}`}</div>
                <div className="mt-3 flex flex-wrap gap-1">{p.products.slice(0, 4).map((x) => <Badge key={x.id}>{x.name}</Badge>)}{p.products.length > 4 && <Badge>+{p.products.length - 4} more</Badge>}</div>
                {p.status === 'DRAFT' && !p.publicationId && can('hq.publish') && <Button variant="primary" className="mt-4 w-full" icon={<Send className="size-4" />} loading={publish.isPending} onClick={() => publish.mutate(p.id)}>Publish</Button>}
              </Card>
            );
          })}
        </div>
      )}
      <PromotionDialog open={creating} onClose={() => setCreating(false)} />
    </PageBody>
  );
}

export function PromotionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const stores = useStores();
  const [f, setF] = useState({ name: '', type: 'PERCENT_OFF', value: '15', startsAt: '', endsAt: '' });
  const [productIds, setProductIds] = useState<{ id: string; name: string }[]>([]);
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const catalogue = useQuery({ queryKey: ['hq', 'catalogue', q], queryFn: () => api.get<{ id: string; name: string; category: string; retailPrice: number }[]>('/hq/catalogue', { q }), enabled: open && q.length >= 2 });
  useEffect(() => {
    if (open) {
      const s = new Date(); s.setHours(0, 0, 0, 0);
      const e = new Date(s.getTime() + 14 * 86_400_000);
      setF({ name: '', type: 'PERCENT_OFF', value: '15', startsAt: s.toISOString().slice(0, 10), endsAt: e.toISOString().slice(0, 10) });
      setProductIds([]);
      setStoreIds(stores.data?.filter((x) => x.status === 'ACTIVE').map((x) => x.id) ?? []);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const value = f.type === 'PERCENT_OFF' ? Number(f.value) : parseMoney(f.value) ?? 0;
  const save = useAction(() => api.post('/hq/promotions', { name: f.name, type: f.type, value, productIds: productIds.map((p) => p.id), storeIds, startsAt: new Date(`${f.startsAt}T00:00:00`).toISOString(), endsAt: new Date(`${f.endsAt}T23:59:59`).toISOString() }), { success: 'Promotion saved as draft', invalidate: [['hq', 'promotions']], onSuccess: onClose });
  return (
    <Dialog open={open} onClose={onClose} size="xl" title="New promotion" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.name || !productIds.length || !storeIds.length || !value} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save draft</Button></>}>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="grid content-start gap-4">
          <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Cold & flu season" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mechanism"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="PERCENT_OFF">% off</option><option value="AMOUNT_OFF">$ off</option><option value="FIXED_PRICE">Fixed price</option></Select></Field>
            <Field label={f.type === 'PERCENT_OFF' ? 'Percent' : 'Amount'}><Input value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
            <Field label="Starts"><Input type="date" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></Field>
            <Field label="Ends"><Input type="date" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>
          </div>
          <div>
            <div className="mb-2 text-[13px] font-medium text-ink-700">Participating stores</div>
            <div className="grid gap-2">{stores.data?.filter((s) => s.status === 'ACTIVE').map((s) => <Checkbox key={s.id} label={`${s.code} · ${s.name}`} checked={storeIds.includes(s.id)} onChange={(v) => setStoreIds((x) => (v ? [...x, s.id] : x.filter((y) => y !== s.id)))} />)}</div>
          </div>
        </div>
        <div>
          <Field label="Products"><SearchInput value={q} onChange={setQ} placeholder="Search front-shop products" /></Field>
          <div className="mt-1 max-h-48 overflow-y-auto rounded-lg ring-1 ring-ink-200">
            {catalogue.data?.map((p) => <button key={p.id} onClick={() => setProductIds((x) => (x.some((y) => y.id === p.id) ? x : [...x, p]))} className="flex w-full justify-between px-3 py-1.5 text-left text-sm hover:bg-ink-50"><span className="truncate">{p.name}</span><span className="text-ink-500">{money(p.retailPrice)}</span></button>)}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">{productIds.map((p) => <button key={p.id} onClick={() => setProductIds((x) => x.filter((y) => y.id !== p.id))}><Badge tone="accent">{p.name} ×</Badge></button>)}</div>
        </div>
      </div>
    </Dialog>
  );
}
