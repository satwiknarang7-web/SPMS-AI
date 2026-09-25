'use client';

import type { SafetyAlert } from '@segue/shared';
import { AlertOctagon, AlertTriangle, Info, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Dialog, Field, Input, Select, Textarea } from '@/components/ui';
import { type Allergy, CONCESSION_LABEL, parseAlerts, parseAllergies, type Patient, type Prescriber } from '@/features/dispense/shared/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { age, date } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export const SEVERITY = {
  HIGH: { icon: AlertOctagon, cls: 'bg-rose-50 ring-rose-200 text-rose-900', iconCls: 'text-rose-600', label: 'High' },
  MODERATE: { icon: AlertTriangle, cls: 'bg-amber-50 ring-amber-200 text-amber-900', iconCls: 'text-amber-600', label: 'Moderate' },
  LOW: { icon: Info, cls: 'bg-sky-50 ring-sky-200 text-sky-900', iconCls: 'text-sky-600', label: 'Low' },
} as const;

export function SafetyAlertList({ alerts, compact }: { alerts: SafetyAlert[]; compact?: boolean }) {
  if (!alerts.length)
    return (
      <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200 ring-inset">
        <ShieldAlert className="size-4" /> No clinical alerts for this supply.
      </div>
    );
  return (
    <ul className="space-y-2">
      {alerts.map((a, i) => {
        const s = SEVERITY[a.severity];
        return (
          <li key={i} className={cn('flex gap-3 rounded-xl p-3 ring-1 ring-inset', s.cls)}>
            <s.icon className={cn('mt-0.5 size-4 shrink-0', s.iconCls)} />
            <div className="min-w-0 text-sm">
              <div className="flex flex-wrap items-center gap-2 font-semibold">
                {a.title}
                <span className="text-[10px] font-bold tracking-wider uppercase opacity-70">{s.label} · {a.type.replace(/_/g, ' ').toLowerCase()}</span>
              </div>
              {!compact && <div className="mt-0.5 opacity-90">{a.detail}</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function PatientSummary({ patient, onClear }: { patient: Patient; onClear?: () => void }) {
  const allergies = parseAllergies(patient);
  const alerts = parseAlerts(patient);
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-ink-50/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary-100 text-sm font-bold text-secondary-700">
            {patient.firstName[0]}
            {patient.lastName[0]}
          </span>
          <div>
            <div className="font-display text-base font-bold text-ink-900">
              {patient.lastName.toUpperCase()}, {patient.firstName}
            </div>
            <div className="mt-0.5 text-xs text-ink-500">
              {date(patient.dob)} · {age(patient.dob)} yrs {patient.medicareNo && <>· Medicare {patient.medicareNo}</>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={patient.concessionType === 'GENERAL' ? 'neutral' : 'violet'}>{CONCESSION_LABEL[patient.concessionType]}</Badge>
          {onClear && (
            <Button size="xs" variant="ghost" onClick={onClear}>
              Change
            </Button>
          )}
        </div>
      </div>
      {allergies.length > 0 && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800">
          <span className="eyebrow mr-2 text-rose-700">Allergies</span>
          {allergies.map((a) => `${a.substance}${a.reaction ? ` (${a.reaction})` : ''}`).join(' · ')}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {allergies.length === 0 && <Badge tone="green">No known allergies</Badge>}
        {alerts.map((a) => (
          <Badge key={a} tone="amber">{a}</Badge>
        ))}
      </div>
    </div>
  );
}

export const emptyPatient = { firstName: '', lastName: '', dob: '', gender: '', medicareNo: '', concessionType: 'GENERAL', concessionNo: '', phone: '', email: '', address: '', notes: '' };

export function PatientFormDialog({ open, onClose, patient, onSaved }: { open: boolean; onClose: () => void; patient?: Patient | null; onSaved?: (p: Patient) => void }) {
  const [form, setForm] = useState(emptyPatient);
  const [allergies, setAllergies] = useState<Allergy[]>([]);
  const [alerts, setAlerts] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    if (patient) {
      setForm({
        firstName: patient.firstName, lastName: patient.lastName, dob: patient.dob.slice(0, 10), gender: patient.gender ?? '', medicareNo: patient.medicareNo ?? '',
        concessionType: patient.concessionType, concessionNo: patient.concessionNo ?? '', phone: patient.phone ?? '', email: patient.email ?? '', address: patient.address ?? '', notes: patient.notes ?? '',
      });
      setAllergies(parseAllergies(patient));
      setAlerts(parseAlerts(patient));
    } else {
      setForm(emptyPatient);
      setAllergies([]);
      setAlerts([]);
    }
  }, [open, patient]);
  const save = useAction(
    () => {
      const body = { ...form, allergies: allergies.filter((a) => a.substance.trim()), alerts: alerts.filter((a) => a.trim()) };
      return patient ? api.patch<Patient>(`/dispense/patients/${patient.id}`, body) : api.post<Patient>('/dispense/patients', body);
    },
    { success: patient ? 'Patient updated' : 'Patient created', invalidate: [['dispense', 'patients'], ['dispense', 'patient']], onSuccess: (p) => { onSaved?.(p); onClose(); } },
  );
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={patient ? 'Edit patient' : 'New patient'}
      description="Personal and health information is handled under the Australian Privacy Principles and every change is audited."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)} disabled={!form.firstName || !form.lastName || !form.dob}>
            Save patient
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" required><Input value={form.firstName} onChange={set('firstName')} /></Field>
        <Field label="Last name" required><Input value={form.lastName} onChange={set('lastName')} /></Field>
        <Field label="Date of birth" required><Input type="date" value={form.dob} onChange={set('dob')} /></Field>
        <Field label="Medicare number" hint="10–11 digits"><Input value={form.medicareNo} onChange={set('medicareNo')} inputMode="numeric" /></Field>
        <Field label="Entitlement">
          <Select value={form.concessionType} onChange={set('concessionType')}>
            <option value="GENERAL">General</option>
            <option value="CONCESSION">Concession / pension</option>
            <option value="DVA">DVA (Repatriation)</option>
          </Select>
        </Field>
        <Field label="Concession / DVA number"><Input value={form.concessionNo} onChange={set('concessionNo')} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={set('email')} /></Field>
        <Field label="Address" className="sm:col-span-2"><Input value={form.address} onChange={set('address')} /></Field>
      </div>
      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-medium text-ink-700">Allergies & intolerances</span>
          <Button size="xs" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setAllergies((a) => [...a, { substance: '', reaction: '', severity: 'MODERATE' }])}>Add</Button>
        </div>
        <div className="space-y-2">
          {allergies.map((a, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_140px_auto] gap-2">
              <Input placeholder="Substance or class (e.g. Penicillin)" value={a.substance} onChange={(e) => setAllergies((xs) => xs.map((x, j) => (j === i ? { ...x, substance: e.target.value } : x)))} />
              <Input placeholder="Reaction" value={a.reaction ?? ''} onChange={(e) => setAllergies((xs) => xs.map((x, j) => (j === i ? { ...x, reaction: e.target.value } : x)))} />
              <Select value={a.severity ?? 'MODERATE'} onChange={(e) => setAllergies((xs) => xs.map((x, j) => (j === i ? { ...x, severity: e.target.value } : x)))}>
                <option value="MILD">Mild</option>
                <option value="MODERATE">Moderate</option>
                <option value="SEVERE">Severe</option>
              </Select>
              <Button variant="ghost" size="sm" onClick={() => setAllergies((xs) => xs.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="size-4" /></Button>
            </div>
          ))}
          {allergies.length === 0 && <p className="text-xs text-ink-500">No allergies recorded. Add any known allergy so it is checked on every supply.</p>}
        </div>
      </div>
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-medium text-ink-700">Patient alerts</span>
          <Button size="xs" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setAlerts((a) => [...a, ''])}>Add</Button>
        </div>
        <div className="space-y-2">
          {alerts.map((a, i) => (
            <div key={i} className="flex gap-2">
              <Input value={a} placeholder="Shown at every dispense, e.g. 'Dose administration aid — weekly'" onChange={(e) => setAlerts((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))} />
              <Button variant="ghost" size="sm" onClick={() => setAlerts((xs) => xs.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="size-4" /></Button>
            </div>
          ))}
        </div>
      </div>
      <Field label="Notes" className="mt-5"><Textarea value={form.notes} onChange={set('notes')} /></Field>
    </Dialog>
  );
}

export function PrescriberFormDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (p: Prescriber) => void }) {
  const [form, setForm] = useState({ name: '', prescriberNo: '', type: 'GP', practice: '', phone: '' });
  useEffect(() => {
    if (open) setForm({ name: '', prescriberNo: '', type: 'GP', practice: '', phone: '' });
  }, [open]);
  const save = useAction(() => api.post<Prescriber>('/dispense/prescribers', form), { success: 'Prescriber added', invalidate: [['dispense', 'prescribers']], onSuccess: (p) => { onSaved(p); onClose(); } });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Dialog open={open} onClose={onClose} title="Add prescriber" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2"><Input value={form.name} onChange={set('name')} placeholder="Dr Jane Citizen" /></Field>
        <Field label="Prescriber number" required><Input value={form.prescriberNo} onChange={set('prescriberNo')} /></Field>
        <Field label="Type">
          <Select value={form.type} onChange={set('type')}>
            <option value="GP">General practitioner</option>
            <option value="SPECIALIST">Specialist</option>
            <option value="NURSE_PRACTITIONER">Nurse practitioner</option>
            <option value="DENTIST">Dentist</option>
            <option value="OPTOMETRIST">Optometrist</option>
          </Select>
        </Field>
        <Field label="Practice"><Input value={form.practice} onChange={set('practice')} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={set('phone')} /></Field>
      </div>
    </Dialog>
  );
}
