'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Layers, Store } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageBody } from '@/components/layout/AppShell';
import { Badge, Card, CardHeader, EmptyState, Loading, NotFound, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime, money } from '@/lib/format';

export interface RuleLike { id?: string; name?: string; groupName?: string | null; markupPct?: number; dispensingFee?: number; copayDiscount?: number; minMarginPct?: number; drugClass?: string | null }

export interface EffectiveConfig {
  store: { id: string; code: string; name: string; online: boolean; status: string };
  groups: { id: string; name: string; priority: number }[];
  precedenceRule: string;
  ranking: { basis: string; fromGroup: string | null; flaggedItems: number };
  pricing: { condition: string; winner: RuleLike | null; overridden: RuleLike[]; classRules: RuleLike[] }[];
  promotions: { id: string; name: string; type: string; value: number; endsAt: string }[];
  pending: { title: string; kind: string; status: string; attempts: number; error: string | null; effectiveAt: string }[];
}

export const ruleText = (r: RuleLike, condition: string) => (condition === 'PRIVATE' ? `${r.markupPct}% markup + ${money(r.dispensingFee ?? 0)} fee, min ${r.minMarginPct}% margin` : r.copayDiscount ? `${money(r.copayDiscount)} co-payment discount` : 'Standard PBS co-payment');

export function StoreConfig() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useQuery({ queryKey: ['hq', 'effective', id], queryFn: () => api.get<EffectiveConfig>(`/hq/stores/${id}/effective-config`) });
  if (isLoading) return <Loading />;
  if (!data) return <NotFound what="store" />;
  return (
    <PageBody>
      <PageHeader back={<Link href="/hq/stores" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800"><ArrowLeft className="size-4" /> Stores</Link>}
        title={data.store.name} subtitle={`${data.store.code} · configuration in effect at this store, and why`} />
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Group precedence" icon={<Layers />} subtitle={data.precedenceRule} />
            <ol className="space-y-2">
              {data.groups.map((g, i) => (
                <li key={g.id} className="flex items-center gap-3 rounded-lg bg-ink-50 px-3 py-2 text-sm">
                  <span className="grid size-6 place-items-center rounded-full bg-[var(--accent)] text-xs font-bold text-white">{i + 1}</span>
                  <span className="flex-1 font-medium text-ink-800">{g.name}</span>
                  <span className="text-xs text-ink-500">priority {g.priority}</span>
                </li>
              ))}
            </ol>
          </Card>
          <Card>
            <CardHeader title="Drug ranking" />
            <div className="text-sm"><div className="font-semibold text-ink-900">{data.ranking.basis.replace(/_/g, ' ').toLowerCase()}</div><div className="text-ink-500">{data.ranking.fromGroup ? `From ${data.ranking.fromGroup}` : 'Default (no group strategy)'} · {data.ranking.flaggedItems} flagged items</div></div>
          </Card>
          <Card>
            <CardHeader title="Pending deliveries" />
            {data.pending.length === 0 ? <p className="text-sm text-emerald-700">Everything published has been applied.</p> : (
              <ul className="space-y-2 text-sm">{data.pending.map((p, i) => <li key={i}><div className="font-medium text-ink-800">{p.title}</div><div className="text-xs text-amber-700">{p.error ?? p.status} · {p.attempts} attempt(s)</div></li>)}</ul>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Dispense pricing in effect" subtitle="Winning rule per condition after precedence" icon={<Store />} />
            <div className="space-y-4">
              {data.pricing.map((p) => (
                <div key={p.condition} className="rounded-xl ring-1 ring-ink-200">
                  <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2.5">
                    <Badge tone="blue">{p.condition}</Badge>
                    {p.winner ? <span className="text-sm text-ink-700"><strong>{p.winner.name}</strong> <span className="text-ink-500">from {p.winner.groupName}</span></span> : <span className="text-sm text-ink-500">No HQ rule — store defaults apply</span>}
                  </div>
                  <div className="space-y-1.5 px-4 py-3 text-sm">
                    {p.winner && <div className="text-ink-800">{ruleText(p.winner, p.condition)}</div>}
                    {p.overridden.map((o) => <div key={o.id} className="text-ink-400 line-through">{o.name} ({o.groupName}) — {ruleText(o, p.condition)}</div>)}
                    {p.classRules.map((o) => <div key={o.id} className="text-ink-600"><Badge tone="violet">{o.drugClass}</Badge> {o.name} ({o.groupName}) — {ruleText(o, p.condition)}</div>)}
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="Active promotions" />
            {data.promotions.length === 0 ? <EmptyState title="No promotions running at this store" /> : (
              <ul className="divide-y divide-ink-100 text-sm">{data.promotions.map((p) => <li key={p.id} className="flex justify-between py-2"><span className="font-medium">{p.name}</span><span className="text-ink-500">ends {dateTime(p.endsAt)}</span></li>)}</ul>
            )}
          </Card>
        </div>
      </div>
    </PageBody>
  );
}
