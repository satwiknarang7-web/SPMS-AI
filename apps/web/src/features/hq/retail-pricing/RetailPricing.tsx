'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageBody } from '@/components/layout/AppShell';
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, Field, Input, Loading, PageHeader, SearchInput, Table, Tabs, TD, TH, THead, TR } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { Store, useStores } from '@/features/hq/shared/stores';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dollars, money, parseMoney, pct } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface RetailRow { id: string; sku: string; name: string; category: string; costPrice: number; masterRetailPrice: number; marginPct: number; minStorePrice: number; maxStorePrice: number; storesDiffering: number }

export interface Inconsistency { store: { id: string; code: string; name: string }; product: { id: string; sku: string; name: string; retailPrice: number; category: string }; storePrice: number; masterPrice: number; diff: number; diffPct: number }

export function RetailPricing() {
  const { can } = useSession();
  const [tab, setTab] = useState<'master' | 'inconsistencies'>('master');
  const [q, setQ] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [publishing, setPublishing] = useState(false);
  const products = useQuery({ queryKey: ['hq', 'retail', q], queryFn: () => api.get<RetailRow[]>('/hq/retail/products', { q }), enabled: tab === 'master' });
  const inc = useQuery({ queryKey: ['hq', 'inconsistencies'], queryFn: () => api.get<Inconsistency[]>('/hq/retail/inconsistencies') });
  const changes = Object.entries(edits).map(([productId, v]) => ({ productId, retailPrice: parseMoney(v) })).filter((c) => c.retailPrice != null && c.retailPrice !== products.data?.find((p) => p.id === c.productId)?.masterRetailPrice) as { productId: string; retailPrice: number }[];
  return (
    <PageBody wide>
      <PageHeader title="Retail pricing" subtitle="Maintain the HQ master price and push updates to all stores or a subset"
        actions={tab === 'master' && can('hq.pricing.write', 'hq.publish') && changes.length > 0 && <Button variant="primary" icon={<Send className="size-4" />} onClick={() => setPublishing(true)}>Publish {changes.length} price(s)</Button>} />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ value: 'master', label: 'HQ master prices' }, { value: 'inconsistencies', label: 'Store inconsistencies', count: inc.data?.length }]} />
      {tab === 'master' ? (
        <>
          <SearchInput value={q} onChange={setQ} placeholder="Product or SKU" className="mb-4 w-80" />
          <Card padded={false}>
            {products.isLoading ? <Loading /> : (
              <Table>
                <THead><tr><TH>Product</TH><TH>Category</TH><TH align="right">Cost</TH><TH align="right">Store range</TH><TH align="right">HQ master</TH><TH align="right">New price</TH><TH align="right">Margin</TH></tr></THead>
                <tbody>
                  {products.data?.map((p) => {
                    const next = edits[p.id] != null ? parseMoney(edits[p.id]!) : null;
                    const price = next ?? p.masterRetailPrice;
                    return (
                      <TR key={p.id} active={next != null && next !== p.masterRetailPrice}>
                        <TD className="font-medium text-ink-900">{p.name}<span className="block font-mono text-xs text-ink-400">{p.sku}</span></TD>
                        <TD className="text-ink-600">{p.category}</TD>
                        <TD align="right">{money(p.costPrice)}</TD>
                        <TD align="right" className="text-ink-500">{p.minStorePrice === p.maxStorePrice ? money(p.minStorePrice) : `${money(p.minStorePrice)} – ${money(p.maxStorePrice)}`}{p.storesDiffering > 0 && <Badge tone="amber" className="ml-1">{p.storesDiffering} differ</Badge>}</TD>
                        <TD align="right" className="font-medium">{money(p.masterRetailPrice)}</TD>
                        <TD align="right"><Input disabled={!can('hq.pricing.write')} value={edits[p.id] ?? dollars(p.masterRetailPrice)} onChange={(e) => setEdits((x) => ({ ...x, [p.id]: e.target.value }))} className="ml-auto w-24 text-right" /></TD>
                        <TD align="right" className={cn(price < p.costPrice ? 'text-rose-600' : '')}>{pct(price ? ((price - p.costPrice) / price) * 100 : 0)}</TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      ) : (
        <Card padded={false}>
          {inc.isLoading ? <Loading /> : !inc.data?.length ? <EmptyState icon={<CheckCircle2 />} title="Every store matches the HQ master" /> : (
            <Table>
              <THead><tr><TH>Store</TH><TH>Product</TH><TH align="right">HQ master</TH><TH align="right">Store price</TH><TH align="right">Difference</TH></tr></THead>
              <tbody>
                {inc.data.map((r) => (
                  <TR key={`${r.store.id}-${r.product.id}`}>
                    <TD>{r.store.code} · {r.store.name}</TD>
                    <TD className="text-ink-900">{r.product.name}</TD>
                    <TD align="right">{money(r.masterPrice)}</TD>
                    <TD align="right" className="font-medium">{money(r.storePrice)}</TD>
                    <TD align="right" className={cn('font-semibold', r.diff > 0 ? 'text-amber-700' : 'text-rose-600')}>{r.diff > 0 ? '+' : ''}{money(r.diff)} ({r.diffPct.toFixed(1)}%)</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
      <PublishRetailDialog open={publishing} changes={changes} onClose={() => setPublishing(false)} onDone={() => { setEdits({}); setPublishing(false); }} />
    </PageBody>
  );
}

export function PublishRetailDialog({ open, changes, onClose, onDone }: { open: boolean; changes: { productId: string; retailPrice: number }[]; onClose: () => void; onDone: () => void }) {
  const stores = useStores();
  const [all, setAll] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  useEffect(() => { if (open) { setAll(true); setSelected([]); setTitle(''); setWhen(''); } }, [open]);
  const publish = useAction(() => api.post('/hq/retail/publish', { title: title || undefined, storeIds: all ? 'ALL' : selected, changes, effectiveAt: when ? new Date(when).toISOString() : null }), { success: 'Price update published', invalidate: [['hq']], onSuccess: onDone });
  return (
    <Dialog open={open} onClose={onClose} title={`Publish ${changes.length} retail price(s)`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!all && !selected.length} loading={publish.isPending} onClick={() => publish.mutate(undefined)}>Publish</Button></>}>
      <div className="grid gap-4">
        <Field label="Title (for the publication log)"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. October price refresh" /></Field>
        <div>
          <Checkbox label="All stores (also updates the HQ master price)" checked={all} onChange={setAll} />
          {!all && <div className="mt-3 grid gap-2 sm:grid-cols-2">{stores.data?.filter((s) => s.status === 'ACTIVE').map((s) => <Checkbox key={s.id} label={`${s.code} · ${s.name}`} checked={selected.includes(s.id)} onChange={(v) => setSelected((x) => (v ? [...x, s.id] : x.filter((y) => y !== s.id)))} />)}</div>}
        </div>
        <Field label="Effective from (optional)" hint="Leave blank to apply immediately"><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
