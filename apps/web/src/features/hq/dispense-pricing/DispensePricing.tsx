'use client';

import { PBS_CONFIG, type PricingCondition, validateDispenseRule } from '@segue/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, Calculator, CalendarClock, PlusCircle, Send, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PageBody } from '@/components/layout/AppShell';
import { Alert, Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, Field, Input, Loading, PageHeader, Select, StatusBadge, Table, TD, TH, THead, TR } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { useGroups } from '@/features/hq/shared/groups';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dateTime, money, num, parseMoney, pct } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface Rule {
  id: string; name: string; groupId: string; groupName: string; condition: PricingCondition; drugClass: string | null; markupPct: number; dispensingFee: number; copayDiscount: number; minMarginPct: number;
  status: string; effectiveAt: string | null; createdAt: string; delivery: { effectiveAt: string; applied: number; total: number } | null;
}

export interface Simulation { violations: { field: string; message: string }[]; stores: number; scripts: number; currentRevenue: number; simulatedRevenue: number; delta: number; currentMarginPct: number; simulatedMarginPct: number; byClass: { drugClass: string; scripts: number; current: number; simulated: number; delta: number }[] }

export const CONDITION_LABEL: Record<PricingCondition, string> = { PBS: 'PBS (general)', CONCESSION: 'PBS concession / RPBS', PRIVATE: 'Private scripts' };

export function DispensePricing() {
  const { can } = useSession();
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState<Rule | null>(null);
  const [deleting, setDeleting] = useState<Rule | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['hq', 'rules'], queryFn: () => api.get<Rule[]>('/hq/pricing/rules') });
  const del = useAction((id: string) => api.delete(`/hq/pricing/rules/${id}`), { success: 'Draft deleted', invalidate: [['hq', 'rules']], onSuccess: () => setDeleting(null) });
  return (
    <PageBody wide>
      <PageHeader title="Centralised dispense pricing" subtitle="Pricing rules by group, condition and drug class — validated against PBS limits before they can be published"
        actions={can('hq.pricing.write') && <Button variant="primary" icon={<PlusCircle className="size-4" />} onClick={() => setCreating(true)}>New rule</Button>} />
      <Alert tone="blue" className="mb-5" title="Regulated limits">
        PBS patient charges are capped at the co-payment ({money(PBS_CONFIG.generalCopay)} general / {money(PBS_CONFIG.concessionCopay)} concession). PBS rules may only apply a discount of up to {money(PBS_CONFIG.maxCopayDiscount)}; markups apply to private scripts only.
      </Alert>
      <Card padded={false}>
        {isLoading ? <Loading /> : !data?.length ? <EmptyState title="No pricing rules" /> : (
          <Table>
            <THead><tr><TH>Rule</TH><TH>Group</TH><TH>Condition</TH><TH>Pricing</TH><TH>Delivery</TH><TH>Status</TH><TH /></tr></THead>
            <tbody>
              {data.map((r) => (
                <TR key={r.id}>
                  <TD><span className="font-medium text-ink-900">{r.name}</span>{r.drugClass && <Badge tone="violet" className="ml-2">{r.drugClass}</Badge>}</TD>
                  <TD>{r.groupName}</TD>
                  <TD><Badge tone="blue">{r.condition}</Badge></TD>
                  <TD className="text-ink-600">{r.condition === 'PRIVATE' ? `${r.markupPct}% + ${money(r.dispensingFee)} · min ${r.minMarginPct}%` : r.copayDiscount ? `${money(r.copayDiscount)} off co-payment` : 'Standard co-payment'}</TD>
                  <TD className="text-ink-500">{r.delivery ? <>{r.delivery.applied}/{r.delivery.total} stores{new Date(r.delivery.effectiveAt) > new Date() && <span className="block text-xs text-tertiary-600">effective {dateTime(r.delivery.effectiveAt)}</span>}</> : '—'}</TD>
                  <TD><StatusBadge status={r.status} /></TD>
                  <TD align="right">
                    {r.status === 'DRAFT' && (
                      <div className="flex justify-end gap-1">
                        {can('hq.publish') && <Button size="sm" variant="primary" icon={<Send className="size-3.5" />} onClick={() => setPublishing(r)}>Publish</Button>}
                        {can('hq.pricing.write') && <Button size="sm" variant="ghost" onClick={() => setDeleting(r)}><Trash2 className="size-3.5" /></Button>}
                      </div>
                    )}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <RuleDialog open={creating} onClose={() => setCreating(false)} />
      <PublishDialog rule={publishing} onClose={() => setPublishing(null)} />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} tone="danger" title={`Delete "${deleting?.name}"?`} confirmLabel="Delete draft" loading={del.isPending} onConfirm={() => deleting && del.mutate(deleting.id)} />
    </PageBody>
  );
}

export function RuleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const groups = useGroups();
  const blank = { name: '', groupId: '', condition: 'PRIVATE' as PricingCondition, drugClass: '', markupPct: '30', dispensingFee: '8.50', copayDiscount: '0.00', minMarginPct: '20' };
  const [f, setF] = useState(blank);
  const [sim, setSim] = useState<Simulation | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  useEffect(() => { if (open) { setF({ ...blank, groupId: groups.data?.[0]?.id ?? '' }); setSim(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const body = { name: f.name, groupId: f.groupId, condition: f.condition, drugClass: f.drugClass || null, markupPct: Number(f.markupPct) || 0, dispensingFee: parseMoney(f.dispensingFee) ?? 0, copayDiscount: parseMoney(f.copayDiscount) ?? 0, minMarginPct: Number(f.minMarginPct) || 0 };
  const violations = useMemo(() => validateDispenseRule(body), [JSON.stringify(body)]); // eslint-disable-line react-hooks/exhaustive-deps
  const simulate = async () => {
    setSimBusy(true);
    setSimError(null);
    try { setSim(await api.post<Simulation>('/hq/pricing/simulate', body)); } catch (e) { setSimError(errorMessage(e)); } finally { setSimBusy(false); }
  };
  const save = useAction(() => api.post('/hq/pricing/rules', body), { success: 'Rule saved as draft', invalidate: [['hq', 'rules']], onSuccess: onClose });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF((x) => ({ ...x, [k]: e.target.value })); setSim(null); };
  const isPbs = f.condition !== 'PRIVATE';
  return (
    <Dialog open={open} onClose={onClose} size="xl" title="New dispense pricing rule" description="Validated live against PBS limits. Simulate against the last 30 days of dispensing before saving."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon={<Calculator className="size-4" />} loading={simBusy} disabled={!f.groupId} onClick={() => void simulate()}>Simulate</Button><Button variant="primary" loading={save.isPending} disabled={violations.length > 0 || !f.name || !f.groupId} onClick={() => save.mutate(undefined)}>Save draft</Button></>}>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="grid content-start gap-4 sm:grid-cols-2">
          <Field label="Rule name" className="sm:col-span-2" required><Input value={f.name} onChange={set('name')} placeholder="e.g. Metro private scripts Q4" /></Field>
          <Field label="Store group"><Select value={f.groupId} onChange={set('groupId')}>{groups.data?.map((g) => <option key={g.id} value={g.id}>{g.name} (priority {g.priority})</option>)}</Select></Field>
          <Field label="Condition"><Select value={f.condition} onChange={set('condition')}>{(Object.keys(CONDITION_LABEL) as PricingCondition[]).map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}</Select></Field>
          <Field label="Drug class (optional)" hint="Class-specific rules beat generic ones" className="sm:col-span-2"><Input value={f.drugClass} onChange={set('drugClass')} placeholder="e.g. Statin" /></Field>
          <Field label="Markup %"><Input value={f.markupPct} onChange={set('markupPct')} disabled={isPbs && f.markupPct === '0'} /></Field>
          <Field label="Dispensing fee"><Input value={f.dispensingFee} onChange={set('dispensingFee')} /></Field>
          <Field label="Co-payment discount" hint={`PBS max ${money(PBS_CONFIG.maxCopayDiscount)}`}><Input value={f.copayDiscount} onChange={set('copayDiscount')} /></Field>
          <Field label="Minimum margin %"><Input value={f.minMarginPct} onChange={set('minMarginPct')} /></Field>
          {isPbs && (f.markupPct !== '0' || f.dispensingFee !== '0.00') && (
            <div className="sm:col-span-2"><Button size="xs" variant="accent-soft" onClick={() => setF((x) => ({ ...x, markupPct: '0', dispensingFee: '0.00', minMarginPct: '0' }))}>Clear markup and fee for PBS</Button></div>
          )}
          {violations.length > 0 && (
            <Alert tone="red" icon={<AlertOctagon />} title="Breaches PBS limits" className="sm:col-span-2">
              <ul className="list-disc pl-4">{violations.map((v) => <li key={v.message}>{v.message}</li>)}</ul>
            </Alert>
          )}
        </div>
        <div>
          <div className="text-[13px] font-semibold text-ink-700">Impact simulation</div>
          {simError && <Alert tone="red" className="mt-2">{simError}</Alert>}
          {!sim ? (
            <div className="mt-2 rounded-xl border border-dashed border-ink-300 p-6 text-center text-sm text-ink-500">Run a simulation to see how this rule would have changed revenue and margin over the last 30 days of matching scripts.</div>
          ) : (
            <div className="mt-2 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-ink-50 p-3"><div className="text-xs text-ink-500">Matching scripts</div><div className="text-xl font-bold tnum">{num(sim.scripts)}</div><div className="text-xs text-ink-500">{sim.stores} stores</div></div>
                <div className={cn('rounded-xl p-3', sim.delta >= 0 ? 'bg-emerald-50' : 'bg-rose-50')}><div className="text-xs text-ink-500">Revenue impact</div><div className={cn('text-xl font-bold tnum', sim.delta >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{sim.delta >= 0 ? '+' : ''}{money(sim.delta)}</div><div className="text-xs text-ink-500">{money(sim.currentRevenue)} → {money(sim.simulatedRevenue)}</div></div>
              </div>
              <div className="text-sm">Margin {pct(sim.currentMarginPct)} → <strong>{pct(sim.simulatedMarginPct)}</strong></div>
              <Table>
                <THead><tr><TH>Drug class</TH><TH align="right">Scripts</TH><TH align="right">Impact</TH></tr></THead>
                <tbody>{sim.byClass.map((c) => <TR key={c.drugClass}><TD>{c.drugClass}</TD><TD align="right">{c.scripts}</TD><TD align="right" className={cn(c.delta >= 0 ? 'text-emerald-700' : 'text-rose-600')}>{money(c.delta)}</TD></TR>)}</tbody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

export function PublishDialog({ rule, onClose }: { rule: Rule | null; onClose: () => void }) {
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  useEffect(() => { if (rule) { setWhen('now'); const d = new Date(Date.now() + 86_400_000); d.setHours(0, 0, 0, 0); setAt(d.toISOString().slice(0, 16)); } }, [rule]);
  const publish = useAction(() => api.post(`/hq/pricing/rules/${rule!.id}/publish`, { effectiveAt: when === 'later' ? new Date(at).toISOString() : null }), { success: 'Published — stores will apply it as they sync', invalidate: [['hq']], onSuccess: onClose });
  return (
    <Dialog open={!!rule} onClose={onClose} size="sm" title={`Publish "${rule?.name}"`} description={`Delivered to every active store in ${rule?.groupName}. Stores that are offline receive it when they reconnect.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={publish.isPending} onClick={() => publish.mutate(undefined)}>Publish</Button></>}>
      <div className="grid gap-3">
        <Select value={when} onChange={(e) => setWhen(e.target.value as 'now')}><option value="now">Effective immediately</option><option value="later">Schedule for a future date</option></Select>
        {when === 'later' && <Field label="Effective from" hint="The change activates automatically at this time"><Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>}
        <p className="flex items-center gap-2 text-xs text-ink-500"><CalendarClock className="size-4" /> Published changes can be rolled back from Publishing & sync.</p>
      </div>
    </Dialog>
  );
}
