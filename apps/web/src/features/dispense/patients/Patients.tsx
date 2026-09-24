'use client';

import { useQuery } from '@tanstack/react-query';
import { UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageBody } from '@/components/layout/AppShell';
import { Badge, Button, Card, EmptyState, Loading, PageHeader, SearchInput, Table, TD, TH, THead, TR } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { PatientFormDialog } from '@/features/dispense/shared/components';
import { CONCESSION_LABEL, type Patient } from '@/features/dispense/shared/types';
import { api } from '@/lib/api';
import { age, date } from '@/lib/format';

export function Patients() {
  const router = useRouter();
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['dispense', 'patients', q], queryFn: () => api.get<Patient[]>('/dispense/patients', { q }) });
  return (
    <PageBody>
      <PageHeader title="Patients" subtitle="Clinical records, allergies and dispensing history" actions={can('dispense.patients.write') && <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>New patient</Button>} />
      <SearchInput value={q} onChange={setQ} placeholder="Search by name, Medicare number or phone" className="mb-4 max-w-lg" autoFocus shortcut="/" />
      <Card padded={false}>
        {isLoading ? (
          <Loading />
        ) : !data?.length ? (
          <EmptyState icon={<Users />} title="No patients found" />
        ) : (
          <Table>
            <THead><tr><TH>Name</TH><TH>Date of birth</TH><TH>Medicare</TH><TH>Entitlement</TH><TH>Allergies</TH><TH>Phone</TH></tr></THead>
            <tbody>
              {data.map((p) => {
                const allergies = JSON.parse(p.allergies || '[]') as { substance: string }[];
                return (
                  <TR key={p.id} onClick={() => router.push(`/dispense/patients/${p.id}`)}>
                    <TD className="font-medium text-ink-900">{p.lastName.toUpperCase()}, {p.firstName}</TD>
                    <TD>{date(p.dob)} <span className="text-ink-400">({age(p.dob)})</span></TD>
                    <TD mono>{p.medicareNo ?? '—'}</TD>
                    <TD><Badge tone={p.concessionType === 'GENERAL' ? 'neutral' : 'violet'}>{CONCESSION_LABEL[p.concessionType]}</Badge></TD>
                    <TD>{allergies.length ? <span className="flex flex-wrap gap-1">{allergies.map((a) => <Badge key={a.substance} tone="red">{a.substance}</Badge>)}</span> : <span className="text-ink-400">None known</span>}</TD>
                    <TD className="text-ink-500">{p.phone ?? '—'}</TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <PatientFormDialog open={creating} onClose={() => setCreating(false)} onSaved={(p) => router.push(`/dispense/patients/${p.id}`)} />
    </PageBody>
  );
}
