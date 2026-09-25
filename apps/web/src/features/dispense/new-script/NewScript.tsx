'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, ListOrdered, Package, Plus, Receipt, ScanLine, Search, ShieldCheck, Star, Stethoscope, Trash2, User, UserPlus } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { PageBody } from '@/components/layout/AppShell';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, Chip, Field, Input, Kbd, PageHeader, ProgressBar, SearchInput, Select, Spinner, Textarea } from '@/components/ui';
import type { Dashboard } from '@/features/dispense/dashboard/DispenseDashboard';
import { useSession } from '@/features/auth/session';
import { PatientFormDialog, PatientSummary, PrescriberFormDialog, SafetyAlertList } from '@/features/dispense/shared/components';
import type { BatchQuote, DrugGroup, DrugItem, ErxToken, Patient, Prescriber } from '@/features/dispense/shared/types';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { money, todayISO } from '@/lib/format';

export const SIG_SHORTCUTS = ['Take ONE tablet daily', 'Take ONE tablet twice daily', 'Take ONE tablet three times daily', 'Take ONE tablet at night', 'Take ONE capsule three times daily until finished', 'Inhale TWO puffs when required', 'Apply thinly twice daily', 'Take as directed by your doctor'];

export type ScriptType = 'PBS' | 'RPBS' | 'PRIVATE';

interface IntakeItem {
  key: string;
  /** Set for items that came from an eRx token (patient, prescriber and supply are pre-filled). */
  token: ErxToken | null;
  tokenPrescriber: Prescriber | null;
  drugQuery: string;
  item: (DrugItem & { groupLabel: string }) | null;
  scriptType: ScriptType;
  quantity: string;
  repeats: string;
  directions: string;
  brandSub: boolean;
}

let itemSeq = 0;
const blankItem = (scriptType: ScriptType = 'PBS'): IntakeItem => ({
  key: `item-${++itemSeq}`, token: null, tokenPrescriber: null, drugQuery: '', item: null, scriptType, quantity: '', repeats: '0', directions: '', brandSub: true,
});

const itemQty = (i: IntakeItem) => Number.parseInt(i.quantity, 10);
const itemTitle = (i: IntakeItem) =>
  i.item ? `${i.item.brandName} · ${i.item.groupLabel}` : i.token?.drug ? `${i.token.drug.genericName} ${i.token.drug.strength}` : 'New medicine';

export function NewScript() {
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useSession();

  const [source, setSource] = useState<'ERX_TOKEN' | 'PAPER'>('ERX_TOKEN');
  const [tokenInput, setTokenInput] = useState('');
  const [tokenBusy, setTokenBusy] = useState(false);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [prescriber, setPrescriber] = useState<Prescriber | null>(null);
  const [prescribedDate, setPrescribedDate] = useState(todayISO());
  const [items, setItems] = useState<IntakeItem[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const defaultType: ScriptType = patient?.concessionType === 'DVA' ? 'RPBS' : 'PBS';
  const patch = (key: string, changes: Partial<IntakeItem>) => setItems((its) => its.map((i) => (i.key === key ? { ...i, ...changes } : i)));

  // Prefill patient from ?patientId=
  const pid = params.get('patientId');
  useEffect(() => {
    if (pid && !patient) void api.get<Patient>(`/dispense/patients/${pid}`).then(setPatient);
  }, [pid, patient]);

  // DVA patients default to RPBS (paper items only — tokens carry their own type).
  useEffect(() => {
    if (!patient) return;
    setItems((its) => its.map((i) => (i.token ? i : { ...i, scriptType: i.scriptType === 'PRIVATE' ? i.scriptType : defaultType })));
  }, [patient?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchSource = (s: 'ERX_TOKEN' | 'PAPER') => {
    if (s === source) return;
    setSource(s);
    const fresh = s === 'PAPER' ? [blankItem(defaultType)] : [];
    setItems(fresh);
    setActiveKey(fresh[0]?.key ?? null);
    if (s === 'ERX_TOKEN') setPatient(null);
  };

  const addPaperItem = () => {
    const next = blankItem(defaultType);
    setItems((its) => [...its, next]);
    setActiveKey(next.key);
  };

  const removeItem = (key: string) => {
    const rest = items.filter((i) => i.key !== key);
    setItems(rest);
    if (activeKey === key) setActiveKey(rest[rest.length - 1]?.key ?? null);
    if (source === 'ERX_TOKEN' && rest.length === 0) setPatient(null);
  };

  const lookupToken = async (raw = tokenInput) => {
    const code = raw.trim().toUpperCase();
    if (!code) return;
    if (items.some((i) => i.token?.token === code)) {
      toast.error(`Token ${code} is already on this intake`);
      return;
    }
    setTokenBusy(true);
    try {
      const t = await api.get<ErxToken>(`/dispense/erx/${encodeURIComponent(code)}`);
      if (patient && t.patientId !== patient.id) {
        toast.error(`Token ${t.token} is for ${t.patient?.firstName} ${t.patient?.lastName}, not ${patient.firstName} ${patient.lastName}. Start a separate intake for them.`);
        return;
      }
      const [p, pr] = await Promise.all([
        patient ? Promise.resolve(patient) : api.get<Patient>(`/dispense/patients/${t.patientId}`),
        api.get<Prescriber[]>('/dispense/prescribers', { q: t.prescriber?.prescriberNo }),
      ]);
      setPatient(p);
      const next: IntakeItem = {
        ...blankItem(t.scriptType),
        token: t,
        tokenPrescriber: pr.find((x) => x.id === t.prescriberId) ?? null,
        drugQuery: t.drug?.genericName ?? '',
        quantity: String(t.quantity),
        repeats: String(t.repeats),
        directions: t.directions,
      };
      setItems((its) => [...its, next]);
      setActiveKey(next.key);
      setTokenInput('');
      toast.success(`eRx token loaded — ${t.drug?.genericName} for ${t.patient?.firstName} ${t.patient?.lastName}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setTokenBusy(false);
    }
  };

  const prescriberFor = (i: IntakeItem) => (i.token ? i.tokenPrescriber : prescriber);
  const itemReady = (i: IntakeItem) => !!(i.item && itemQty(i) > 0 && i.directions.trim().length > 1 && prescriberFor(i));

  // Live price and safety quote for every item that has a medicine and quantity; items are also checked against each other.
  const quotable = patient ? items.filter((i) => i.item && itemQty(i) > 0) : [];
  const quoteItems = quotable.map((i) => ({ drugId: i.item!.drugId, productId: i.item!.productId, scriptType: i.scriptType, quantity: itemQty(i) }));
  const quote = useQuery({
    queryKey: ['dispense', 'quote-batch', patient?.id, JSON.stringify(quoteItems)],
    queryFn: () => api.post<BatchQuote>('/dispense/scripts/quote-batch', { patientId: patient!.id, items: quoteItems }),
    enabled: !!patient && quoteItems.length > 0,
    placeholderData: keepPreviousData,
  });
  const quoteFor = (key: string) => {
    const idx = quotable.findIndex((i) => i.key === key);
    return idx >= 0 && quote.data?.items.length === quotable.length ? quote.data.items[idx] : undefined;
  };

  const readyCount = items.filter(itemReady).length;
  const ready = !!patient && items.length > 0 && readyCount === items.length;
  const queue = useQuery({ queryKey: ['dispense', 'dashboard'], queryFn: () => api.get<Dashboard>('/dispense/dashboard'), refetchInterval: 20_000 });

  const save = async (then: 'check' | 'submit' | 'stay') => {
    if (!ready || !patient) return;
    setSaving(true);
    try {
      const res = await api.post<{ batchId: string | null; scripts: { id: string; number: string }[] }>('/dispense/scripts/batch', {
        patientId: patient.id,
        submit: then === 'submit',
        items: items.map((i) => ({
          prescriberId: prescriberFor(i)!.id,
          drugId: i.item!.drugId,
          productId: i.item!.productId,
          scriptType: i.scriptType,
          source: i.token ? 'ERX_TOKEN' : 'PAPER',
          erxToken: i.token?.token ?? null,
          prescribedDate: i.token ? i.token.prescribedDate : prescribedDate,
          directions: i.directions.trim(),
          quantity: itemQty(i),
          repeatsTotal: Number.parseInt(i.repeats, 10) || 0,
          brandSubstitution: i.brandSub,
        })),
      });
      const numbers = res.scripts.map((s) => s.number).join(', ');
      toast.success(res.scripts.length > 1 ? `${res.scripts.length} scripts saved (${numbers})` : `Script ${numbers} saved`);
      router.push(`/dispense/scripts/${res.scripts[0]!.id}${then === 'check' ? '?check=1' : ''}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const tokenItems = items.filter((i) => i.token);
  const alertCount = quote.data?.items.reduce((n, i) => n + i.alerts.length, 0) ?? 0;

  return (
    <PageBody wide>
      <PageHeader
        eyebrow="Dispense • Intake"
        title="New script"
        subtitle="Receive, verify and prepare one or more medicines for a patient"
        actions={
          <>
            <Chip tone="primary" icon={<Check />}>PBS Ready</Chip>
            <Chip tone="secondary" icon={<ScanLine />}>eRx Gateway Sync</Chip>
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-5">
          {/* 1. Source */}
          <Step n={1} title="Prescription" icon={<ScanLine />} done={source === 'PAPER' || tokenItems.length > 0}>
            <div className="mb-4 inline-flex rounded-xl border border-[var(--line)] bg-white p-1">
              {(['ERX_TOKEN', 'PAPER'] as const).map((s) => (
                <button key={s} onClick={() => switchSource(s)} className={cn('rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors', source === s ? 'bg-primary-700 text-white shadow-sm' : 'text-ink-500 hover:bg-ink-50')}>
                  {s === 'ERX_TOKEN' ? 'Electronic (eRx tokens)' : 'Paper script'}
                </button>
              ))}
            </div>
            {source === 'ERX_TOKEN' ? (
              <>
                <form onSubmit={(e) => { e.preventDefault(); void lookupToken(); }} className="flex gap-2">
                  <Input autoFocus icon={<ScanLine />} placeholder={tokenItems.length ? 'Scan the next token for this patient' : 'Scan the token barcode or QR code, or type it'} value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} className="flex-1 font-mono uppercase" />
                  <Button type="submit" variant="primary" loading={tokenBusy}>{tokenItems.length ? 'Add token' : 'Retrieve'}</Button>
                </form>
                {tokenItems.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {tokenItems.map((i) => (
                      <span key={i.key} className="inline-flex items-center gap-2 rounded-lg border border-primary-100 bg-[var(--accent-soft)] px-2.5 py-1 text-xs">
                        <span className="font-mono font-semibold text-ink-900">{i.token!.token}</span>
                        <span className="text-ink-600">{i.token!.drug?.genericName} {i.token!.drug?.strength}</span>
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-xs text-ink-500">Scan every token the patient has brought in — each medicine becomes its own script, checked against the others.</p>
              </>
            ) : (
              <div className="grid gap-4 sm:grid-cols-[1fr_220px] sm:items-end">
                <p className="text-sm text-ink-500">Enter the patient, prescriber and each medicine written on the paper prescription below.</p>
                <Field label="Date prescribed">
                  <Input type="date" value={prescribedDate} onChange={(e) => setPrescribedDate(e.target.value)} max={todayISO()} />
                </Field>
              </div>
            )}
          </Step>

          {/* 2. Patient */}
          <Step n={2} title="Patient" icon={<User />} done={!!patient}>
            {patient ? (
              <PatientSummary patient={patient} onClear={tokenItems.length ? undefined : () => setPatient(null)} />
            ) : source === 'ERX_TOKEN' ? (
              <p className="text-sm text-ink-500">The patient is filled in from the first token you scan.</p>
            ) : (
              <PatientPicker onPick={setPatient} canCreate={can('dispense.patients.write')} />
            )}
          </Step>

          {/* 3. Prescriber */}
          <Step n={3} title="Prescriber" icon={<Stethoscope />} done={items.length > 0 && items.every((i) => !!prescriberFor(i))}>
            {source === 'ERX_TOKEN' ? (
              tokenItems.length ? (
                <div className="space-y-2">
                  {[...new Map(tokenItems.map((i) => [i.token!.prescriberId, i])).values()].map((i) => (
                    <div key={i.key} className="rounded-xl border border-[var(--line)] bg-ink-50/70 px-4 py-3 text-sm">
                      <div className="font-semibold text-ink-900">{i.tokenPrescriber?.name ?? i.token!.prescriber?.name}</div>
                      <div className="text-ink-500">Prescriber no. {i.token!.prescriber?.prescriberNo}{i.tokenPrescriber?.practice && ` · ${i.tokenPrescriber.practice}`}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ink-500">Taken from each eRx token.</p>
              )
            ) : prescriber ? (
              <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-ink-50/70 px-4 py-3 text-sm">
                <div>
                  <div className="font-semibold text-ink-900">{prescriber.name}</div>
                  <div className="text-ink-500">Prescriber no. {prescriber.prescriberNo} · {prescriber.practice}</div>
                </div>
                <Button size="xs" variant="ghost" onClick={() => setPrescriber(null)}>Change</Button>
              </div>
            ) : (
              <PrescriberPicker onPick={setPrescriber} canCreate={can('dispense.prescribers.write')} />
            )}
          </Step>

          {/* 4. Medicines */}
          <Step n={4} title={items.length > 1 ? `Medicines (${items.length})` : 'Medicine'} icon={<Package />} done={items.length > 0 && readyCount === items.length}>
            {items.length === 0 && <p className="text-sm text-ink-500">Scan an eRx token to add its medicine.</p>}
            <div className="space-y-3">
              {items.map((i, idx) => (
                <IntakeItemCard
                  key={i.key}
                  index={idx}
                  item={i}
                  open={activeKey === i.key}
                  ready={itemReady(i)}
                  quote={quoteFor(i.key)}
                  onToggle={() => setActiveKey(activeKey === i.key ? null : i.key)}
                  onRemove={items.length > 1 || source === 'ERX_TOKEN' ? () => removeItem(i.key) : undefined}
                  onChange={(changes) => patch(i.key, changes)}
                />
              ))}
            </div>
            {source === 'PAPER' && (
              <Button className="mt-4" variant="outline" icon={<Plus className="size-4" />} onClick={addPaperItem} disabled={items.length >= 12}>
                Add another medicine
              </Button>
            )}
          </Step>
        </div>

        {/* Summary / live checks */}
        <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <Card>
            <CardHeader title="Pricing" icon={<Receipt />} actions={quote.isFetching ? <Spinner className="size-4" /> : null} />
            {quote.data && quotable.length > 0 ? (
              <>
                <div className="rounded-2xl bg-primary-50 px-4 py-3.5">
                  <div className="eyebrow text-primary-700">Patient pays{quotable.length > 1 && ` · ${quotable.length} items`}</div>
                  <div className="font-display text-[32px] leading-tight font-extrabold text-ink-900 tnum">{money(quote.data.totalPatientPrice)}</div>
                </div>
                <dl className="mt-4 divide-y divide-ink-100 text-sm">
                  {quotable.map((i, idx) => {
                    const q = quote.data.items[idx];
                    return q ? (
                      <Row
                        key={i.key}
                        label={`${items.indexOf(i) + 1}. ${i.item!.brandName}`}
                        value={<span className="inline-flex items-center gap-2">{q.price.safetyNetReached && <Badge tone="violet">Safety net</Badge>}<Badge tone="blue">{i.scriptType}</Badge>{money(q.price.patientPrice)}</span>}
                      />
                    ) : null;
                  })}
                </dl>
                {quotable.length < items.length && <p className="mt-3 text-xs text-ink-500">{items.length - quotable.length} item(s) still need a medicine and quantity.</p>}
              </>
            ) : (
              <p className="text-sm text-ink-500">Select a patient, then a medicine and quantity for each item to see the price.</p>
            )}
          </Card>
          <Card>
            <CardHeader title="Clinical safety" icon={<ShieldCheck />} actions={quote.data ? <Badge tone={alertCount ? 'amber' : 'green'} dot>{alertCount ? `${alertCount} alert${alertCount > 1 ? 's' : ''}` : 'Active'}</Badge> : <Badge tone="green" dot>Active</Badge>} />
            {quote.data && quotable.length > 0 ? (
              <div className="space-y-4">
                {quotable.map((i, idx) => {
                  const q = quote.data.items[idx];
                  if (!q) return null;
                  return (
                    <div key={i.key}>
                      {quotable.length > 1 && <div className="eyebrow mb-2 text-ink-500">{items.indexOf(i) + 1}. {i.item!.brandName}</div>}
                      <SafetyAlertList alerts={q.alerts} compact={quotable.length > 1} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-ink-500">Allergy, interaction and duplicate-therapy checks run as each medicine is selected — including between medicines on this intake.</p>
            )}
            {quote.data?.requiresIntervention && (
              <Alert tone="red" className="mt-3" title="Intervention required at final check">
                A high-severity alert must be reviewed and an intervention recorded before the affected item can be dispensed.
              </Alert>
            )}
          </Card>
          <Card>
            <div className="grid gap-2">
              {can('dispense.scripts.check') && (
                <Button variant="secondary" size="lg" disabled={!ready} loading={saving} onClick={() => void save('check')} icon={<Check className="size-4" />}>
                  Save & final check
                </Button>
              )}
              <Button variant="primary" size="lg" disabled={!ready} loading={saving} onClick={() => void save('submit')}>
                {items.length > 1 ? `Save ${items.length} scripts & send for check` : 'Save & send for check'}
              </Button>
              <Button variant="ghost" disabled={!ready || saving} onClick={() => void save('stay')}>Save as in progress</Button>
            </div>
            {!ready && <p className="mt-3 text-xs text-ink-500">Complete the patient, prescriber and every medicine to save.</p>}
          </Card>
          <Card>
            <CardHeader title="Dispensary queue" subtitle="Live at this store" icon={<ListOrdered />} />
            <div className="mb-1.5 flex justify-between text-xs font-semibold text-ink-500">
              <span>This intake</span>
              <span className="tnum">{readyCount} / {Math.max(items.length, 1)} items ready</span>
            </div>
            <ProgressBar value={readyCount} max={Math.max(items.length, 1)} />
            <dl className="mt-4 divide-y divide-ink-100 text-sm">
              <Row label="In progress" value={queue.data?.counts.IN_PROGRESS ?? 0} />
              <Row label="Awaiting final check" value={queue.data?.counts.AWAITING_CHECK ?? 0} />
              <Row label="Ready for collection" value={queue.data?.counts.READY ?? 0} />
            </dl>
          </Card>
        </div>
      </div>
    </PageBody>
  );
}

/** One medicine on the intake: collapsed summary, or the pack picker and supply details when open. */
export function IntakeItemCard({ index, item: i, open, ready, quote, onToggle, onRemove, onChange }: {
  index: number;
  item: IntakeItem;
  open: boolean;
  ready: boolean;
  quote?: BatchQuote['items'][number];
  onToggle: () => void;
  onRemove?: () => void;
  onChange: (changes: Partial<IntakeItem>) => void;
}) {
  const high = quote?.alerts.filter((a) => a.severity === 'HIGH').length ?? 0;
  return (
    <div className={cn('overflow-hidden rounded-2xl border transition-colors', open ? 'border-primary-200 shadow-[var(--shadow-card)]' : 'border-[var(--line)]')}>
      <div className="flex items-center gap-3 bg-white px-4 py-3">
        <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className={cn('grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold', ready ? 'bg-primary-700 text-white' : 'bg-tertiary-50 text-tertiary-600 ring-1 ring-tertiary-100')}>
            {ready ? <Check className="size-3.5" /> : index + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink-900">{itemTitle(i)}</span>
            <span className="block truncate text-xs text-ink-500">
              {i.token ? <span className="font-mono">{i.token.token}</span> : 'Paper'}
              {itemQty(i) > 0 && ` · qty ${i.quantity}`}
              {` · ${i.repeats || 0} repeat(s)`}
              {i.directions && ` · ${i.directions}`}
            </span>
          </span>
          {high > 0 && <Badge tone="red">{high} high alert{high > 1 ? 's' : ''}</Badge>}
          {quote && <span className="text-sm font-semibold text-ink-900 tnum">{money(quote.price.patientPrice)}</span>}
          <ChevronDown className={cn('size-4 shrink-0 text-ink-400 transition-transform', open && 'rotate-180')} />
        </button>
        {onRemove && (
          <button onClick={onRemove} className="rounded-lg p-1.5 text-ink-400 hover:bg-rose-50 hover:text-rose-600" title="Remove this medicine" aria-label={`Remove item ${index + 1}`}>
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
      {open && (
        <div className="border-t border-[var(--line)] bg-ink-50/40 px-4 py-4">
          {i.item ? (
            <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-sm">
              <div>
                <div className="font-semibold text-ink-900">{i.item.brandName} <span className="font-normal text-ink-500">· {i.item.groupLabel}</span></div>
                <div className="text-ink-500">Pack of {i.item.packSize} · {i.item.onHand} in stock {i.item.pbsCode && <>· PBS {i.item.pbsCode}</>}</div>
              </div>
              <Button size="xs" variant="ghost" onClick={() => onChange({ item: null })}>Change</Button>
            </div>
          ) : (
            <DrugPicker
              query={i.drugQuery}
              onQuery={(q) => onChange({ drugQuery: q })}
              preferredDrugId={i.token?.drugId}
              onPick={(it) => onChange({ item: it, quantity: i.quantity || (it.maxQuantity ? String(it.maxQuantity) : '') })}
            />
          )}
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Script type">
              <Select value={i.scriptType} onChange={(e) => onChange({ scriptType: e.target.value as ScriptType })}>
                <option value="PBS">PBS</option>
                <option value="RPBS">RPBS (DVA)</option>
                <option value="PRIVATE">Private</option>
              </Select>
            </Field>
            <Field label="Quantity" hint={i.item?.maxQuantity ? `PBS max ${i.item.maxQuantity}` : undefined} required>
              <Input type="number" min={1} value={i.quantity} onChange={(e) => onChange({ quantity: e.target.value })} />
            </Field>
            <Field label="Repeats" hint={i.item?.maxRepeats != null ? `PBS max ${i.item.maxRepeats}` : undefined}>
              <Input type="number" min={0} max={11} value={i.repeats} onChange={(e) => onChange({ repeats: e.target.value })} />
            </Field>
          </div>
          <Field label="Directions (SIG)" className="mt-4" required>
            <Textarea value={i.directions} onChange={(e) => onChange({ directions: e.target.value })} placeholder="e.g. Take ONE tablet daily" className="min-h-16" />
          </Field>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SIG_SHORTCUTS.map((s) => (
              <button key={s} onClick={() => onChange({ directions: s })} className="rounded-full border border-[var(--line)] bg-white px-3 py-1 text-xs font-medium text-ink-600 hover:border-primary-200 hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]">{s}</button>
            ))}
          </div>
          <div className="mt-4">
            <Checkbox label="Brand substitution permitted" checked={i.brandSub} onChange={(v) => onChange({ brandSub: v })} />
          </div>
          {quote && quote.alerts.length > 0 && (
            <div className="mt-4">
              <SafetyAlertList alerts={quote.alerts} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-right font-semibold text-ink-900 tnum">{value}</dd>
    </div>
  );
}

export function Step({ n, title, icon, done, children }: { n: number; title: string; icon: ReactNode; done: boolean; children: ReactNode }) {
  return (
    <Card>
      <div className="mb-5 flex items-center gap-3">
        <span className={cn('grid size-8 place-items-center rounded-full text-[13px] font-bold transition-colors', done ? 'bg-primary-700 text-white' : 'bg-tertiary-50 text-tertiary-600 ring-1 ring-tertiary-100')}>{done ? <Check className="size-4" /> : n}</span>
        <h3 className="text-base font-bold text-ink-900">{title}</h3>
        <span className="ml-auto text-ink-300 [&>svg]:size-4">{icon}</span>
      </div>
      {children}
    </Card>
  );
}

export function PatientPicker({ onPick, canCreate }: { onPick: (p: Patient) => void; canCreate: boolean }) {
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const { data, isFetching } = useQuery({ queryKey: ['dispense', 'patients', q], queryFn: () => api.get<Patient[]>('/dispense/patients', { q }), enabled: q.length >= 2 });
  return (
    <div>
      <div className="flex gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Search by name, Medicare or phone" className="flex-1" autoFocus />
        {canCreate && <Button icon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>New patient</Button>}
      </div>
      {q.length >= 2 && (
        <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-[var(--line)]">
          {isFetching && !data ? (
            <div className="p-4"><Spinner /></div>
          ) : data?.length ? (
            data.map((p) => (
              <button key={p.id} onClick={() => onPick(p)} className="flex w-full items-center justify-between border-b border-ink-100 px-4 py-2.5 text-left text-sm last:border-0 hover:bg-ink-50">
                <span>
                  <span className="font-medium text-ink-900">{p.lastName.toUpperCase()}, {p.firstName}</span>
                  <span className="ml-2 text-ink-500">{new Date(p.dob).toLocaleDateString('en-AU')}</span>
                </span>
                <span className="flex items-center gap-2">
                  {JSON.parse(p.allergies || '[]').length > 0 && <Badge tone="red">Allergies</Badge>}
                  {p.concessionType !== 'GENERAL' && <Badge tone="violet">{p.concessionType === 'DVA' ? 'DVA' : 'Concession'}</Badge>}
                </span>
              </button>
            ))
          ) : (
            <div className="p-4 text-sm text-ink-500">No matching patients.</div>
          )}
        </div>
      )}
      <PatientFormDialog open={creating} onClose={() => setCreating(false)} onSaved={onPick} />
    </div>
  );
}

export function PrescriberPicker({ onPick, canCreate }: { onPick: (p: Prescriber) => void; canCreate: boolean }) {
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const { data } = useQuery({ queryKey: ['dispense', 'prescribers', q], queryFn: () => api.get<Prescriber[]>('/dispense/prescribers', { q }) });
  return (
    <div>
      <div className="flex gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Name, prescriber number or practice" className="flex-1" />
        {canCreate && <Button onClick={() => setCreating(true)}>Add prescriber</Button>}
      </div>
      <div className="mt-2 grid max-h-56 gap-1.5 overflow-y-auto sm:grid-cols-2">
        {data?.map((p) => (
          <button key={p.id} onClick={() => onPick(p)} className="rounded-xl border border-[var(--line)] px-3 py-2 text-left text-sm hover:border-primary-300 hover:bg-[var(--accent-soft)]/50">
            <div className="font-medium text-ink-900">{p.name}</div>
            <div className="text-xs text-ink-500">{p.prescriberNo} · {p.practice}</div>
          </button>
        ))}
      </div>
      <PrescriberFormDialog open={creating} onClose={() => setCreating(false)} onSaved={onPick} />
    </div>
  );
}

export function DrugPicker({ query, onQuery, onPick, preferredDrugId }: { query: string; onQuery: (q: string) => void; onPick: (i: DrugItem & { groupLabel: string }) => void; preferredDrugId?: string }) {
  const { data, isFetching } = useQuery({ queryKey: ['dispense', 'drugs', query], queryFn: () => api.get<DrugGroup[]>('/dispense/drugs', { q: query }), enabled: query.trim().length >= 2 });
  const groups = useMemo(() => data ?? [], [data]);
  return (
    <div>
      <SearchInput value={query} onChange={onQuery} placeholder="Generic or brand name, or PBS code" />
      {isFetching && !data && <div className="py-4"><Spinner /></div>}
      <div className="mt-3 space-y-3">
        {groups.map((g) => (
          <div key={`${g.genericName}${g.strength}${g.form}`} className="overflow-hidden rounded-xl border border-[var(--line)]">
            <div className="flex items-center justify-between bg-ink-50 px-4 py-2 text-sm">
              <span className="font-semibold text-ink-800">{g.genericName} {g.strength} <span className="font-normal text-ink-500">{g.form.toLowerCase()}</span></span>
              <span className="text-xs text-ink-500">Ranked by {g.basis.replace(/_/g, ' ').toLowerCase()}</span>
            </div>
            {g.items.map((it) => (
              <button
                key={it.drugId}
                onClick={() => onPick({ ...it, groupLabel: `${g.genericName} ${g.strength} ${g.form.toLowerCase()}` })}
                disabled={!it.productId}
                className={cn('flex w-full items-center gap-3 border-t border-ink-100 px-4 py-2.5 text-left text-sm hover:bg-[var(--accent-soft)] disabled:opacity-50', it.drugId === preferredDrugId && 'bg-tertiary-50/60')}
              >
                <span className={cn('grid size-6 shrink-0 place-items-center rounded-md text-xs font-bold', it.rank === 1 && it.onHand > 0 ? 'bg-[var(--accent)] text-white' : 'bg-ink-100 text-ink-500')}>{it.rank}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-ink-900">{it.brandName}</span>
                  {it.flag === 'PREFERRED' && <Star className="ml-1.5 inline size-3.5 fill-amber-400 text-amber-400" />}
                  {it.drugId === preferredDrugId && <Badge tone="violet" className="ml-2">Prescribed</Badge>}
                  <span className="block text-xs text-ink-500">{it.reason} · pack {it.packSize}{it.brandPremium > 0 && ` · brand premium ${money(it.brandPremium)}`}</span>
                </span>
                <span className="flex items-center gap-2">
                  {it.flag === 'RESTRICTED' && <Badge tone="amber">Restricted</Badge>}
                  {it.schedule === 'S8' && <Badge tone="red">S8</Badge>}
                  <Badge tone={it.onHand > 0 ? 'green' : 'red'}>{it.onHand} in stock</Badge>
                </span>
              </button>
            ))}
            {g.excluded.length > 0 && <div className="border-t border-ink-100 px-4 py-2 text-xs text-ink-500">Excluded by head office: {g.excluded.join(', ')}</div>}
          </div>
        ))}
        {query.length >= 2 && data && groups.length === 0 && <p className="flex items-center gap-2 text-sm text-ink-500"><Search className="size-4" /> No medicines match “{query}”.</p>}
        {!query && <p className="text-xs text-ink-500">Tip: press <Kbd>/</Kbd> anywhere to search.</p>}
      </div>
    </div>
  );
}
