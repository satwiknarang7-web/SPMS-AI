'use client';

import type { SafetyAlert } from '@segue/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, ClipboardCheck, Clock, PauseCircle, Printer, Repeat, ScanLine, Send, ShieldCheck, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { useUrlSearchParams } from '@/lib/navigation';
import { PageBody } from '@/components/layout/AppShell';
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, DescriptionList, Dialog, Field, Input, Loading, NotFound, PageHeader, Select, StatusBadge, Textarea } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { DispenseLabel } from '@/features/dispense/scripts/DispenseLabel';
import { PatientSummary, SafetyAlertList } from '@/features/dispense/shared/components';
import { type Patient, SCRIPT_STATUS_LABEL } from '@/features/dispense/shared/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { date, dateTime, money } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface ScriptDetailData {
  id: string;
  number: string;
  status: string;
  scriptType: string;
  source: string;
  erxToken: string | null;
  prescribedDate: string;
  directions: string;
  quantity: number;
  repeatsTotal: number;
  supplyNo: number;
  brandSubstitution: boolean;
  patientPrice: number | null;
  governmentContribution: number | null;
  safetyNetContribution: number | null;
  pricingBasis: string | null;
  scanVerified: boolean;
  dispensedAt: string | null;
  collectedAt: string | null;
  saleId: string | null;
  alerts: SafetyAlert[];
  patient: Patient & { allergies: unknown; alerts: unknown };
  prescriber: { name: string; prescriberNo: string; practice: string | null };
  drug: { brandName: string; genericName: string; strength: string; form: string; schedule: string | null; packSize: number; pbsCode: string | null };
  product: { id: string; name: string; barcode: string | null } | null;
  interventions: { id: string; alertType: string; outcome: string; note: string; createdAt: string }[];
  preparedBy: string | null;
  checkedBy: string | null;
  store: { name: string; suburb: string; state: string } | null;
  supplies: { id: string; number: string; supplyNo: number; status: string; dispensedAt: string | null }[];
  auditTrail: { id: string; action: string; summary: string; userName: string | null; createdAt: string; hash: string }[];
}

export function ScriptDetail() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useUrlSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { can, hasModule } = useSession();
  const { data: s, isLoading } = useQuery({ queryKey: ['dispense', 'script', id], queryFn: () => api.get<ScriptDetailData>(`/dispense/scripts/${id}`) });
  const [checkOpen, setCheckOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | 'defer' | 'cancel'>(null);

  useEffect(() => {
    if (params.get('check') && s && ['IN_PROGRESS', 'AWAITING_CHECK'].includes(s.status) && can('dispense.scripts.check')) {
      setCheckOpen(true);
      setParams({}, { replace: true });
    }
  }, [params, s, can, setParams]);

  const invalidate = [['dispense']];
  const submit = useAction(() => api.post(`/dispense/scripts/${id}/submit`), { success: 'Sent for pharmacist check', invalidate });
  const resume = useAction(() => api.post(`/dispense/scripts/${id}/resume`), { success: 'Script resumed', invalidate });
  const collect = useAction(() => api.post(`/dispense/scripts/${id}/collect`), { success: 'Marked as collected', invalidate });
  const repeat = useAction(() => api.post<{ id: string; number: string }>(`/dispense/scripts/${id}/repeat`), { success: (r) => `Repeat started as ${r.number}`, invalidate, onSuccess: (r) => router.push(`/dispense/scripts/${r.id}`) });
  const reasonAction = useAction(({ kind, reason }: { kind: 'defer' | 'cancel'; reason: string }) => api.post(`/dispense/scripts/${id}/${kind}`, { reason }), {
    success: 'Script updated',
    invalidate,
    onSuccess: () => setConfirm(null),
  });

  if (isLoading) return <Loading />;
  if (!s) return <NotFound what="prescription" />;
  const working = ['IN_PROGRESS', 'AWAITING_CHECK'].includes(s.status);
  const dispensed = ['READY', 'COLLECTED'].includes(s.status);
  const lastSupply = s.supplies[s.supplies.length - 1];
  const canRepeat = dispensed && lastSupply?.id === s.id && s.supplyNo < s.repeatsTotal;

  return (
    <PageBody wide>
      <PageHeader
        back={<Link href="/dispense/scripts" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800"><ArrowLeft className="size-4" /> Script queue</Link>}
        title={<span className="flex items-center gap-3">{s.drug.brandName} {s.drug.strength}<StatusBadge status={s.status} label={SCRIPT_STATUS_LABEL[s.status]} /></span>}
        subtitle={<span className="font-mono">{s.number}{s.supplyNo > 0 && ` · repeat ${s.supplyNo} of ${s.repeatsTotal}`}</span>}
        actions={
          <>
            {working && can('dispense.scripts.write') && <Button icon={<PauseCircle className="size-4" />} onClick={() => setConfirm('defer')}>Defer</Button>}
            {(working || s.status === 'DEFERRED') && can('dispense.scripts.write') && <Button variant="ghost" icon={<XCircle className="size-4" />} onClick={() => setConfirm('cancel')}>Cancel</Button>}
            {s.status === 'DEFERRED' && can('dispense.scripts.write') && <Button onClick={() => resume.mutate(undefined)} loading={resume.isPending}>Resume</Button>}
            {s.status === 'IN_PROGRESS' && can('dispense.scripts.write') && <Button icon={<Send className="size-4" />} onClick={() => submit.mutate(undefined)} loading={submit.isPending}>Send for check</Button>}
            {dispensed && <Button icon={<Printer className="size-4" />} onClick={() => setLabelOpen(true)}>Label</Button>}
            {canRepeat && can('dispense.scripts.write') && <Button icon={<Repeat className="size-4" />} onClick={() => repeat.mutate(undefined)} loading={repeat.isPending}>Dispense repeat</Button>}
            {s.status === 'READY' && !hasModule('POS') && can('dispense.scripts.write') && <Button variant="primary" onClick={() => collect.mutate(undefined)} loading={collect.isPending}>Mark collected</Button>}
            {working && can('dispense.scripts.check') && <Button variant="primary" size="lg" icon={<ClipboardCheck className="size-4" />} onClick={() => setCheckOpen(true)}>Final check</Button>}
          </>
        }
      />

      {s.status === 'READY' && hasModule('POS') && (
        <Alert tone="blue" icon={<Clock />} className="mb-5" title="Ready for collection">The patient pays at the register — scan {s.number} or search their name in POS.</Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Patient" />
            <PatientSummary patient={s.patient as Patient} />
            <div className="mt-3 text-right">
              <Link href={`/dispense/patients/${s.patient.id}`} className="text-sm font-medium text-[var(--accent)]">Open patient record →</Link>
            </div>
          </Card>
          <Card>
            <CardHeader title="Prescription" />
            <DescriptionList
              columns={3}
              items={[
                { label: 'Medicine', value: `${s.drug.genericName} ${s.drug.strength} ${s.drug.form.toLowerCase()}` },
                { label: 'Pack dispensed', value: s.product?.name ?? 'Not selected' },
                { label: 'PBS code', value: s.drug.pbsCode ?? '—' },
                { label: 'Quantity', value: s.quantity },
                { label: 'Repeats', value: `${s.repeatsTotal - s.supplyNo} of ${s.repeatsTotal} remaining` },
                { label: 'Type', value: <span className="flex gap-1"><Badge tone="blue">{s.scriptType}</Badge>{s.drug.schedule && <Badge tone={s.drug.schedule === 'S8' ? 'red' : 'neutral'}>{s.drug.schedule}</Badge>}</span> },
                { label: 'Prescriber', value: `${s.prescriber.name} (${s.prescriber.prescriberNo})` },
                { label: 'Prescribed', value: date(s.prescribedDate) },
                { label: 'Source', value: s.source === 'PAPER' ? 'Paper' : `eRx ${s.erxToken ?? ''}` },
              ]}
            />
            <div className="mt-4 rounded-xl bg-ink-50 px-4 py-3">
              <div className="text-xs font-medium text-ink-500">Directions</div>
              <div className="mt-0.5 font-semibold text-ink-900 uppercase">{s.directions}</div>
            </div>
            {!s.brandSubstitution && <Alert className="mt-3" tone="amber">Brand substitution not permitted by the prescriber.</Alert>}
          </Card>

          <Card>
            <CardHeader title="Clinical safety" subtitle={dispensed ? 'Alerts at the time of the final check' : 'Re-checked when the pharmacist performs the final check'} />
            <SafetyAlertList alerts={s.alerts} />
            {s.interventions.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 text-[13px] font-semibold text-ink-700">Interventions recorded</div>
                <ul className="space-y-2">
                  {s.interventions.map((i) => (
                    <li key={i.id} className="rounded-xl bg-ink-50 p-3 text-sm ring-1 ring-ink-200/70">
                      <div className="flex items-center gap-2 font-medium text-ink-800"><ShieldCheck className="size-4 text-emerald-600" /> {i.alertType.replace(/_/g, ' ').toLowerCase()} — {i.outcome.replace(/_/g, ' ').toLowerCase()}</div>
                      <div className="mt-1 text-ink-600">{i.note}</div>
                      <div className="mt-1 text-xs text-ink-400">{dateTime(i.createdAt)}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Pricing" />
            <div className="text-xs text-ink-500">Patient pays</div>
            <div className="text-3xl font-bold tracking-tight text-ink-900 tnum">{money(s.patientPrice)}</div>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-ink-500">Basis</dt><dd className="text-right text-ink-800">{s.pricingBasis}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">Government</dt><dd className="tnum">{money(s.governmentContribution)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">Safety net</dt><dd className="tnum">{money(s.safetyNetContribution)}</dd></div>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Dispensing record" />
            <DescriptionList
              columns={1}
              items={[
                { label: 'Prepared by', value: s.preparedBy ?? '—' },
                { label: 'Final check', value: s.checkedBy ? `${s.checkedBy} · ${dateTime(s.dispensedAt)}` : 'Pending' },
                { label: 'Pack verification', value: dispensed ? (s.scanVerified ? <span className="inline-flex items-center gap-1 text-emerald-700"><ScanLine className="size-4" /> Barcode scan matched</span> : 'Manual verification (reason in audit)') : '—' },
                { label: 'Collected', value: s.collectedAt ? dateTime(s.collectedAt) : '—' },
              ]}
            />
          </Card>
          {s.supplies.length > 1 && (
            <Card>
              <CardHeader title="Supplies on this prescription" />
              <ul className="space-y-1.5 text-sm">
                {s.supplies.map((x) => (
                  <li key={x.id}>
                    <Link href={`/dispense/scripts/${x.id}`} className={cn('flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-ink-50', x.id === s.id && 'bg-[var(--accent-soft)]')}>
                      <span className="font-mono text-xs">{x.number} · {x.supplyNo === 0 ? 'Original' : `Repeat ${x.supplyNo}`}</span>
                      <StatusBadge status={x.status} label={SCRIPT_STATUS_LABEL[x.status]} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title="Script audit" subtitle="Tamper-evident — every event is hash-chained" />
            <ol className="relative space-y-4 border-l border-ink-200 pl-5">
              {s.auditTrail.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute top-1 -left-[25px] size-2.5 rounded-full bg-[var(--accent)] ring-4 ring-white" />
                  <div className="text-sm text-ink-800">{e.summary}</div>
                  <div className="mt-0.5 text-xs text-ink-500">{e.userName ?? 'System'} · {dateTime(e.createdAt)} · <span className="font-mono" title={e.hash}>#{e.hash.slice(0, 8)}</span></div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <FinalCheckDialog open={checkOpen} onClose={() => setCheckOpen(false)} script={s} onDone={() => { void qc.invalidateQueries({ queryKey: ['dispense'] }); setCheckOpen(false); setLabelOpen(true); }} />
      <LabelDialog open={labelOpen} onClose={() => setLabelOpen(false)} script={s} />
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'defer' ? 'Defer this script?' : 'Cancel this script?'}
        description={confirm === 'defer' ? 'The script stays on file and can be resumed later.' : 'Cancelled scripts cannot be dispensed. An eRx token is released back to the exchange.'}
        confirmLabel={confirm === 'defer' ? 'Defer script' : 'Cancel script'}
        tone={confirm === 'cancel' ? 'danger' : 'primary'}
        requireReason
        loading={reasonAction.isPending}
        onConfirm={(reason) => confirm && reasonAction.mutate({ kind: confirm, reason })}
      />
    </PageBody>
  );
}

export function FinalCheckDialog({ open, onClose, script, onDone }: { open: boolean; onClose: () => void; script: ScriptDetailData; onDone: () => void }) {
  const [scan, setScan] = useState('');
  const [manual, setManual] = useState(false);
  const [manualReason, setManualReason] = useState('');
  const [notes, setNotes] = useState<Record<string, { outcome: string; note: string }>>({});
  const scanRef = useRef<HTMLInputElement>(null);
  const high = script.alerts.filter((a) => a.severity === 'HIGH');
  const highTypes = [...new Set(high.map((a) => a.type))];

  useEffect(() => {
    if (open) {
      setScan('');
      setManual(false);
      setManualReason('');
      setNotes(Object.fromEntries(highTypes.map((t) => [t, { outcome: 'SUPPLIED_AFTER_REVIEW', note: '' }])));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const expected = script.product?.barcode ?? '';
  const scanState = !scan ? 'idle' : scan.trim() === expected ? 'match' : 'mismatch';
  const interventionsOk = highTypes.every((t) => (notes[t]?.note.trim().length ?? 0) >= 3);
  const verifyOk = manual ? manualReason.trim().length >= 5 : scanState === 'match';

  const check = useAction(
    () =>
      api.post(`/dispense/scripts/${script.id}/check`, {
        scannedBarcode: manual ? null : scan.trim(),
        manualVerificationReason: manual ? manualReason.trim() : null,
        interventions: highTypes.map((t) => ({ alertType: t, outcome: notes[t]!.outcome, note: notes[t]!.note.trim() })),
      }),
    { success: `Script ${script.number} dispensed`, onSuccess: onDone },
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Final check"
      description="Confirm the summary, scan the pack, and record interventions for any high-severity alert."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Back</Button>
          <Button variant="primary" size="lg" icon={<CheckCircle2 className="size-4" />} disabled={!verifyOk || !interventionsOk} loading={check.isPending} onClick={() => check.mutate(undefined)}>
            Approve & dispense
          </Button>
        </>
      }
    >
      <div className="grid gap-3 rounded-xl bg-ink-50 p-4 text-sm sm:grid-cols-2">
        <div><div className="text-xs text-ink-500">Patient</div><div className="font-semibold text-ink-900">{script.patient.lastName.toUpperCase()}, {script.patient.firstName}</div></div>
        <div><div className="text-xs text-ink-500">Medicine</div><div className="font-semibold text-ink-900">{script.product?.name}</div></div>
        <div><div className="text-xs text-ink-500">Quantity / repeats</div><div className="text-ink-900">{script.quantity} · {script.repeatsTotal - script.supplyNo} repeat(s) remaining</div></div>
        <div><div className="text-xs text-ink-500">Patient pays</div><div className="text-ink-900">{money(script.patientPrice)} <span className="text-ink-500">({script.pricingBasis})</span></div></div>
        <div className="sm:col-span-2"><div className="text-xs text-ink-500">Directions</div><div className="font-semibold text-ink-900 uppercase">{script.directions}</div></div>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-ink-800">Scan check</span>
          <button className="text-xs font-medium text-[var(--accent)]" onClick={() => { setManual((m) => !m); setTimeout(() => scanRef.current?.focus(), 30); }}>
            {manual ? 'Scan the pack instead' : "Can't scan? Verify manually"}
          </button>
        </div>
        {manual ? (
          <Field label="Reason for manual verification" hint="Recorded in the script audit (e.g. damaged barcode, split pack).">
            <Input value={manualReason} onChange={(e) => setManualReason(e.target.value)} />
          </Field>
        ) : (
          <>
            <Input
              ref={scanRef}
              icon={<ScanLine />}
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              placeholder="Scan the pack barcode"
              className={cn('font-mono', scanState === 'match' && '[&_input]:ring-2 [&_input]:ring-emerald-500', scanState === 'mismatch' && '[&_input]:ring-2 [&_input]:ring-rose-500')}
            />
            {scanState === 'match' && <p className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-emerald-700"><CheckCircle2 className="size-4" /> Pack matches {script.product?.name}</p>}
            {scanState === 'mismatch' && <p className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-rose-700"><XCircle className="size-4" /> This pack does not match the selected item.</p>}
            <p className="mt-1.5 text-xs text-ink-400">Demo: expected barcode <button className="font-mono underline" onClick={() => setScan(expected)}>{expected}</button></p>
          </>
        )}
      </div>

      <div className="mt-5">
        <div className="mb-2 text-[13px] font-semibold text-ink-800">Clinical alerts</div>
        <SafetyAlertList alerts={script.alerts} compact />
        {highTypes.map((t) => (
          <div key={t} className="mt-3 rounded-xl p-3 ring-1 ring-rose-200">
            <div className="mb-2 text-sm font-semibold text-rose-800">Intervention — {t.replace(/_/g, ' ').toLowerCase()}</div>
            <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
              <Select value={notes[t]?.outcome} onChange={(e) => setNotes((n) => ({ ...n, [t]: { ...n[t]!, outcome: e.target.value } }))}>
                <option value="SUPPLIED_AFTER_REVIEW">Supplied after review</option>
                <option value="PRESCRIBER_CONTACTED">Prescriber contacted</option>
              </Select>
              <Textarea className="min-h-10" value={notes[t]?.note ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [t]: { ...n[t]!, note: e.target.value } }))} placeholder="What was reviewed, discussed or agreed" />
            </div>
          </div>
        ))}
        {high.length > 0 && <p className="mt-2 text-xs text-ink-500">Alerts support — never replace — professional judgement. If the medicine should not be supplied, cancel or defer the script instead.</p>}
      </div>
    </Dialog>
  );
}

export function LabelDialog({ open, onClose, script }: { open: boolean; onClose: () => void; script: ScriptDetailData }) {
  return (
    <>
      <Dialog open={open} onClose={onClose} title="Dispensing label" size="sm" footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" icon={<Printer className="size-4" />} onClick={() => window.print()}>Print</Button></>}>
        <DispenseLabel s={script} />
      </Dialog>
      {open && createPortal(<div className="print-only"><DispenseLabel s={script} /></div>, document.body)}
    </>
  );
}
