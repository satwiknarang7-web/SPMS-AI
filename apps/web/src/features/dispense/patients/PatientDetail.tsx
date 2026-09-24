'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Pencil, PlusCircle } from 'lucide-react';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { PageBody } from '@/components/layout/AppShell';
import { Badge, Button, Card, CardHeader, DescriptionList, EmptyState, Loading, NotFound, PageHeader, ProgressBar, StatusBadge, Table, TD, TH, THead, TR } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { Patients } from '@/features/dispense/patients/Patients';
import { PatientFormDialog, PatientSummary } from '@/features/dispense/shared/components';
import { CONCESSION_LABEL, type Patient, SCRIPT_STATUS_LABEL } from '@/features/dispense/shared/types';
import { api } from '@/lib/api';
import { age, date, money } from '@/lib/format';

export interface PatientDetailData extends Patient {
  history: { id: string; number: string; status: string; scriptType: string; quantity: number; dispensedAt: string | null; createdAt: string; patientPrice: number | null; drug: { brandName: string; strength: string; genericName: string }; prescriber: { name: string } }[];
  currentMedications: { name: string; ingredient: string; drugClass: string | null; lastDispensedAt: string; scriptId: string }[];
  safetyNet: { total: number; threshold: number; reached: boolean };
  customer: { id: string; name: string; balance: number; hasAccount: boolean } | null;
}

export function PatientDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSession();
  const [editing, setEditing] = useState(false);
  const { data: p, isLoading } = useQuery({ queryKey: ['dispense', 'patient', id], queryFn: () => api.get<PatientDetailData>(`/dispense/patients/${id}`) });
  if (isLoading) return <Loading />;
  if (!p) return <NotFound what="patient" />;
  return (
    <PageBody>
      <PageHeader
        back={<Link href="/dispense/patients" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800"><ArrowLeft className="size-4" /> Patients</Link>}
        title={`${p.firstName} ${p.lastName}`}
        subtitle={`${date(p.dob)} · ${age(p.dob)} years`}
        actions={
          <>
            {can('dispense.patients.write') && <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Edit</Button>}
            {can('dispense.scripts.write') && <Button variant="primary" icon={<PlusCircle className="size-4" />} onClick={() => router.push(`/dispense/new?patientId=${p.id}`)}>New script</Button>}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <PatientSummary patient={p} />
          <Card padded={false}>
            <div className="p-5 pb-0"><CardHeader title="Dispensing history" subtitle={`${p.history.length} records`} /></div>
            {p.history.length === 0 ? (
              <EmptyState title="No dispensing history" />
            ) : (
              <Table>
                <THead><tr><TH>Script</TH><TH>Medicine</TH><TH>Prescriber</TH><TH>Status</TH><TH align="right">Paid</TH><TH align="right">Date</TH></tr></THead>
                <tbody>
                  {p.history.map((h) => (
                    <TR key={h.id} onClick={() => router.push(`/dispense/scripts/${h.id}`)}>
                      <TD mono>{h.number}</TD>
                      <TD><span className="text-ink-900">{h.drug.brandName} {h.drug.strength}</span><span className="block text-xs text-ink-500">qty {h.quantity} · {h.scriptType}</span></TD>
                      <TD className="text-ink-600">{h.prescriber.name}</TD>
                      <TD><StatusBadge status={h.status} label={SCRIPT_STATUS_LABEL[h.status]} /></TD>
                      <TD align="right">{money(h.patientPrice)}</TD>
                      <TD align="right" className="text-ink-500">{date(h.dispensedAt ?? h.createdAt)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="PBS safety net" subtitle={`Calendar year · ${CONCESSION_LABEL[p.concessionType]}`} />
            <div className="flex items-end justify-between">
              <div className="text-2xl font-bold text-ink-900 tnum">{money(p.safetyNet.total)}</div>
              <div className="text-sm text-ink-500">of {money(p.safetyNet.threshold)}</div>
            </div>
            <ProgressBar value={p.safetyNet.total} max={p.safetyNet.threshold} className="mt-2" />
            {p.safetyNet.reached && <Badge tone="violet" className="mt-3">Threshold reached — reduced co-payments apply</Badge>}
          </Card>
          <Card>
            <CardHeader title="Current medications" subtitle="Supplied in the last 180 days — used for interaction checks" />
            {p.currentMedications.length === 0 ? (
              <p className="text-sm text-ink-500">None on record.</p>
            ) : (
              <ul className="space-y-2">
                {p.currentMedications.map((m) => (
                  <li key={m.scriptId} className="flex items-center justify-between text-sm">
                    <span><span className="font-medium text-ink-900">{m.name}</span><span className="block text-xs text-ink-500">{m.drugClass}</span></span>
                    <span className="text-xs text-ink-500">{date(m.lastDispensedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Details" />
            <DescriptionList
              columns={1}
              items={[
                { label: 'Medicare', value: p.medicareNo ?? '—' },
                { label: 'Concession / DVA no.', value: p.concessionNo ?? '—' },
                { label: 'Phone', value: p.phone ?? '—' },
                { label: 'Email', value: p.email ?? '—' },
                { label: 'Address', value: p.address ?? '—' },
                { label: 'Customer account', value: p.customer?.hasAccount ? `${p.customer.name} · balance ${money(p.customer.balance)}` : 'None' },
              ]}
            />
          </Card>
        </div>
      </div>
      <PatientFormDialog open={editing} onClose={() => setEditing(false)} patient={p} />
    </PageBody>
  );
}
