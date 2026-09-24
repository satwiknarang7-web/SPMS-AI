'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, FileText, Package, ScanLine, Search, Star, Stethoscope, User, UserPlus } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { PageBody } from '@/components/layout/AppShell';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Kbd, PageHeader, SearchInput, Select, Spinner, Textarea } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { PatientFormDialog, PatientSummary, PrescriberFormDialog, SafetyAlertList } from '@/features/dispense/shared/components';
import type { DrugGroup, DrugItem, ErxToken, Patient, Prescriber, Quote } from '@/features/dispense/shared/types';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { money, todayISO } from '@/lib/format';

export const SIG_SHORTCUTS = ['Take ONE tablet daily', 'Take ONE tablet twice daily', 'Take ONE tablet three times daily', 'Take ONE tablet at night', 'Take ONE capsule three times daily until finished', 'Inhale TWO puffs when required', 'Apply thinly twice daily', 'Take as directed by your doctor'];

export type ScriptType = 'PBS' | 'RPBS' | 'PRIVATE';

export function NewScript() {
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useSession();

  const [source, setSource] = useState<'ERX_TOKEN' | 'PAPER'>('ERX_TOKEN');
  const [tokenInput, setTokenInput] = useState('');
  const [token, setToken] = useState<ErxToken | null>(null);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [prescriber, setPrescriber] = useState<Prescriber | null>(null);
  const [drugQuery, setDrugQuery] = useState('');
  const [item, setItem] = useState<(DrugItem & { groupLabel: string }) | null>(null);
  const [scriptType, setScriptType] = useState<ScriptType>('PBS');
  const [quantity, setQuantity] = useState('');
  const [repeats, setRepeats] = useState('0');
  const [directions, setDirections] = useState('');
  const [prescribedDate, setPrescribedDate] = useState(todayISO());
  const [brandSub, setBrandSub] = useState(true);
  const [saving, setSaving] = useState(false);

  // Prefill patient from ?patientId=
  const pid = params.get('patientId');
  useEffect(() => {
    if (pid && !patient) void api.get<Patient>(`/dispense/patients/${pid}`).then(setPatient);
  }, [pid, patient]);

  // DVA patients default to RPBS.
  useEffect(() => {
    if (patient?.concessionType === 'DVA' && scriptType === 'PBS') setScriptType('RPBS');
    if (patient && patient.concessionType !== 'DVA' && scriptType === 'RPBS') setScriptType('PBS');
  }, [patient]); // eslint-disable-line react-hooks/exhaustive-deps

  const lookupToken = async (raw = tokenInput) => {
    const code = raw.trim().toUpperCase();
    if (!code) return;
    setTokenBusy(true);
    try {
      const t = await api.get<ErxToken>(`/dispense/erx/${encodeURIComponent(code)}`);
      setToken(t);
      const [p, pr] = await Promise.all([api.get<Patient>(`/dispense/patients/${t.patientId}`), api.get<Prescriber[]>('/dispense/prescribers', { q: t.prescriber?.prescriberNo })]);
      setPatient(p);
      setPrescriber(pr.find((x) => x.id === t.prescriberId) ?? null);
      setScriptType(t.scriptType);
      setQuantity(String(t.quantity));
      setRepeats(String(t.repeats));
      setDirections(t.directions);
      setPrescribedDate(t.prescribedDate.slice(0, 10));
      setDrugQuery(t.drug?.genericName ?? '');
      setItem(null);
      toast.success(`eRx token loaded — ${t.drug?.genericName} for ${t.patient?.firstName} ${t.patient?.lastName}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setTokenBusy(false);
    }
  };

  // Live price and safety quote.
  const qty = Number.parseInt(quantity, 10);
  const quoteKey = patient && item && qty > 0 ? [patient.id, item.drugId, item.productId, scriptType, qty] : null;
  const quote = useQuery({
    queryKey: ['dispense', 'quote', ...(quoteKey ?? [])],
    queryFn: () => api.post<Quote>('/dispense/scripts/quote', { patientId: patient!.id, drugId: item!.drugId, productId: item!.productId, scriptType, quantity: qty }),
    enabled: !!quoteKey,
  });

  const ready = patient && prescriber && item && qty > 0 && directions.trim().length > 1 && (source === 'PAPER' || token);

  const save = async (then: 'check' | 'submit' | 'stay') => {
    if (!ready) return;
    setSaving(true);
    try {
      const script = await api.post<{ id: string; number: string }>('/dispense/scripts', {
        patientId: patient.id, prescriberId: prescriber.id, drugId: item.drugId, productId: item.productId, scriptType, source,
        erxToken: source === 'ERX_TOKEN' ? token?.token : null, prescribedDate, directions: directions.trim(), quantity: qty, repeatsTotal: Number.parseInt(repeats, 10) || 0, brandSubstitution: brandSub,
      });
      if (then === 'submit') await api.post(`/dispense/scripts/${script.id}/submit`);
      toast.success(`Script ${script.number} saved`);
      router.push(`/dispense/scripts/${script.id}${then === 'check' ? '?check=1' : ''}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageBody wide>
      <PageHeader eyebrow="Dispense" title="New script" subtitle="Receive, verify and prepare a prescription" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-5">
          {/* 1. Source */}
          <Step n={1} title="Prescription" icon={<ScanLine />} done={source === 'PAPER' || !!token}>
            <div className="mb-4 inline-flex rounded-xl bg-ink-100 p-1">
              {(['ERX_TOKEN', 'PAPER'] as const).map((s) => (
                <button key={s} onClick={() => { setSource(s); if (s === 'PAPER') setToken(null); }} className={cn('rounded-lg px-4 py-1.5 text-sm font-medium', source === s ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500')}>
                  {s === 'ERX_TOKEN' ? 'Electronic (eRx token)' : 'Paper script'}
                </button>
              ))}
            </div>
            {source === 'ERX_TOKEN' ? (
              token ? (
                <div className="flex items-center justify-between rounded-xl bg-[var(--accent-soft)] px-4 py-3 text-sm">
                  <div>
                    <div className="font-mono font-semibold text-ink-900">{token.token}</div>
                    <div className="text-ink-600">{token.drug?.brandName} {token.drug?.strength} · qty {token.quantity} · {token.repeats} repeat(s) · {token.prescriber?.name}</div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => { setToken(null); setTokenInput(''); }}>Change</Button>
                </div>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); void lookupToken(); }} className="flex gap-2">
                  <Input autoFocus icon={<ScanLine />} placeholder="Scan the token barcode or QR code, or type it" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} className="flex-1 font-mono uppercase" />
                  <Button type="submit" variant="primary" loading={tokenBusy}>Retrieve</Button>
                </form>
              )
            ) : (
              <p className="text-sm text-ink-500">Enter the patient, prescriber and medicine from the paper prescription below.</p>
            )}
          </Step>

          {/* 2. Patient */}
          <Step n={2} title="Patient" icon={<User />} done={!!patient}>
            {patient ? <PatientSummary patient={patient} onClear={token ? undefined : () => setPatient(null)} /> : <PatientPicker onPick={setPatient} canCreate={can('dispense.patients.write')} />}
          </Step>

          {/* 3. Prescriber */}
          <Step n={3} title="Prescriber" icon={<Stethoscope />} done={!!prescriber}>
            {prescriber ? (
              <div className="flex items-center justify-between rounded-xl bg-ink-50 px-4 py-3 text-sm ring-1 ring-ink-200/70">
                <div>
                  <div className="font-semibold text-ink-900">{prescriber.name}</div>
                  <div className="text-ink-500">Prescriber no. {prescriber.prescriberNo} · {prescriber.practice}</div>
                </div>
                {!token && <Button size="xs" variant="ghost" onClick={() => setPrescriber(null)}>Change</Button>}
              </div>
            ) : (
              <PrescriberPicker onPick={setPrescriber} canCreate={can('dispense.prescribers.write')} />
            )}
          </Step>

          {/* 4. Medicine */}
          <Step n={4} title="Medicine" icon={<Package />} done={!!item}>
            {item ? (
              <div className="flex items-center justify-between rounded-xl bg-ink-50 px-4 py-3 text-sm ring-1 ring-ink-200/70">
                <div>
                  <div className="font-semibold text-ink-900">{item.brandName} <span className="font-normal text-ink-500">· {item.groupLabel}</span></div>
                  <div className="text-ink-500">Pack of {item.packSize} · {item.onHand} in stock {item.pbsCode && <>· PBS {item.pbsCode}</>}</div>
                </div>
                <Button size="xs" variant="ghost" onClick={() => setItem(null)}>Change</Button>
              </div>
            ) : (
              <DrugPicker
                query={drugQuery}
                onQuery={setDrugQuery}
                preferredDrugId={token?.drugId}
                onPick={(it) => {
                  setItem(it);
                  if (!quantity && it.maxQuantity) setQuantity(String(it.maxQuantity));
                }}
              />
            )}
          </Step>

          {/* 5. Directions & quantity */}
          <Step n={5} title="Directions & supply" icon={<FileText />} done={!!(qty > 0 && directions.trim())}>
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="Script type">
                <Select value={scriptType} onChange={(e) => setScriptType(e.target.value as ScriptType)}>
                  <option value="PBS">PBS</option>
                  <option value="RPBS">RPBS (DVA)</option>
                  <option value="PRIVATE">Private</option>
                </Select>
              </Field>
              <Field label="Quantity" hint={item?.maxQuantity ? `PBS max ${item.maxQuantity}` : undefined} required>
                <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </Field>
              <Field label="Repeats" hint={item?.maxRepeats != null ? `PBS max ${item.maxRepeats}` : undefined}>
                <Input type="number" min={0} max={11} value={repeats} onChange={(e) => setRepeats(e.target.value)} />
              </Field>
              <Field label="Date prescribed">
                <Input type="date" value={prescribedDate} onChange={(e) => setPrescribedDate(e.target.value)} max={todayISO()} />
              </Field>
            </div>
            <Field label="Directions (SIG)" className="mt-4" required>
              <Textarea value={directions} onChange={(e) => setDirections(e.target.value)} placeholder="e.g. Take ONE tablet daily" className="min-h-16" />
            </Field>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SIG_SHORTCUTS.map((s) => (
                <button key={s} onClick={() => setDirections(s)} className="rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-600 hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]">{s}</button>
              ))}
            </div>
            <div className="mt-4">
              <Checkbox label="Brand substitution permitted" checked={brandSub} onChange={setBrandSub} />
            </div>
          </Step>
        </div>

        {/* Summary / live checks */}
        <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-ink-900">Pricing</h3>
              {quote.isFetching && <Spinner className="size-4" />}
            </div>
            {quote.data ? (
              <>
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-xs text-ink-500">Patient pays</div>
                    <div className="text-3xl font-bold tracking-tight text-ink-900 tnum">{money(quote.data.price.patientPrice)}</div>
                  </div>
                  {quote.data.price.safetyNetReached && <Badge tone="violet">Safety net reached</Badge>}
                </div>
                <dl className="mt-4 space-y-1.5 text-sm">
                  <Row label="Basis" value={quote.data.price.basis} />
                  {quote.data.price.governmentContribution > 0 && <Row label="Government contribution" value={money(quote.data.price.governmentContribution)} />}
                  {quote.data.price.brandPremium > 0 && <Row label="Brand premium" value={money(quote.data.price.brandPremium)} />}
                  <Row label="Counts to safety net" value={money(quote.data.price.safetyNetContribution)} />
                  <Row label="Packs to dispense" value={quote.data.price.packs} />
                  {quote.data.price.ruleGroup && <Row label="Pricing rule from" value={quote.data.price.ruleGroup} />}
                </dl>
              </>
            ) : (
              <p className="text-sm text-ink-500">Select a patient, medicine and quantity to see the price.</p>
            )}
          </Card>
          <Card>
            <h3 className="mb-3 text-[15px] font-semibold text-ink-900">Clinical safety</h3>
            {quote.data ? <SafetyAlertList alerts={quote.data.alerts} /> : <p className="text-sm text-ink-500">Allergy, interaction and duplicate-therapy checks run as soon as the medicine is selected.</p>}
            {quote.data?.requiresIntervention && (
              <Alert tone="red" className="mt-3" title="Intervention required at final check">
                A high-severity alert must be reviewed and an intervention recorded before this can be dispensed.
              </Alert>
            )}
          </Card>
          <Card>
            <div className="grid gap-2">
              {can('dispense.scripts.check') && (
                <Button variant="primary" size="lg" disabled={!ready} loading={saving} onClick={() => void save('check')} icon={<Check className="size-4" />}>
                  Save & final check
                </Button>
              )}
              <Button variant={can('dispense.scripts.check') ? 'secondary' : 'primary'} size="lg" disabled={!ready} loading={saving} onClick={() => void save('submit')}>
                Save & send for pharmacist check
              </Button>
              <Button variant="ghost" disabled={!ready || saving} onClick={() => void save('stay')}>Save as in progress</Button>
            </div>
            {!ready && <p className="mt-3 text-xs text-ink-500">Complete all five steps to save.</p>}
          </Card>
        </div>
      </div>
    </PageBody>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-right font-medium text-ink-800 tnum">{value}</dd>
    </div>
  );
}

export function Step({ n, title, icon, done, children }: { n: number; title: string; icon: ReactNode; done: boolean; children: ReactNode }) {
  return (
    <Card>
      <div className="mb-4 flex items-center gap-3">
        <span className={cn('grid size-7 place-items-center rounded-full text-xs font-bold', done ? 'bg-[var(--accent)] text-white' : 'bg-ink-100 text-ink-500')}>{done ? <Check className="size-3.5" /> : n}</span>
        <span className="text-ink-400 [&>svg]:size-4">{icon}</span>
        <h3 className="text-[15px] font-semibold text-ink-900">{title}</h3>
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
        <div className="mt-2 max-h-72 overflow-y-auto rounded-xl ring-1 ring-ink-200">
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
          <button key={p.id} onClick={() => onPick(p)} className="rounded-lg px-3 py-2 text-left text-sm ring-1 ring-ink-200 hover:bg-ink-50 hover:ring-[var(--accent)]">
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
          <div key={`${g.genericName}${g.strength}${g.form}`} className="overflow-hidden rounded-xl ring-1 ring-ink-200">
            <div className="flex items-center justify-between bg-ink-50 px-4 py-2 text-sm">
              <span className="font-semibold text-ink-800">{g.genericName} {g.strength} <span className="font-normal text-ink-500">{g.form.toLowerCase()}</span></span>
              <span className="text-xs text-ink-500">Ranked by {g.basis.replace(/_/g, ' ').toLowerCase()}</span>
            </div>
            {g.items.map((it) => (
              <button
                key={it.drugId}
                onClick={() => onPick({ ...it, groupLabel: `${g.genericName} ${g.strength} ${g.form.toLowerCase()}` })}
                disabled={!it.productId}
                className={cn('flex w-full items-center gap-3 border-t border-ink-100 px-4 py-2.5 text-left text-sm hover:bg-[var(--accent-soft)] disabled:opacity-50', it.drugId === preferredDrugId && 'bg-violet-50/60')}
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
