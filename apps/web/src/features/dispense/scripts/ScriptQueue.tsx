'use client';

import { useQuery } from '@tanstack/react-query';
import { PlusCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useUrlSearchParams } from '@/lib/navigation';
import { PageBody } from '@/components/layout/AppShell';
import { Badge, Button, Card, EmptyState, Loading, PageHeader, SearchInput, StatusBadge, Table, Tabs, TD, TH, THead, TR } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { SCRIPT_STATUS_LABEL, type ScriptRow } from '@/features/dispense/shared/types';
import { api } from '@/lib/api';
import { money, relative } from '@/lib/format';

export const TABS = [
  { value: 'IN_PROGRESS,AWAITING_CHECK', label: 'Working' },
  { value: 'AWAITING_CHECK', label: 'Awaiting check' },
  { value: 'READY', label: 'Ready' },
  { value: 'DEFERRED', label: 'Deferred' },
  { value: 'COLLECTED', label: 'Collected' },
  { value: '', label: 'All' },
];

export function ScriptQueue() {
  const router = useRouter();
  const { can } = useSession();
  const [params, setParams] = useUrlSearchParams();
  const status = params.get('status') ?? 'IN_PROGRESS,AWAITING_CHECK';
  const q = params.get('q') ?? '';
  const { data, isLoading } = useQuery({ queryKey: ['dispense', 'scripts', status, q], queryFn: () => api.get<ScriptRow[]>('/dispense/scripts', { status, q }), refetchInterval: 15_000 });
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    if (k === 'status' && !v) p.set('status', '');
    setParams(p, { replace: true });
  };

  return (
    <PageBody>
      <PageHeader title="Script queue" subtitle="Every prescription at this store, by stage" actions={can('dispense.scripts.write') && <Button variant="primary" icon={<PlusCircle className="size-4" />} onClick={() => router.push('/dispense/new')}>New script</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs tabs={TABS} value={TABS.some((t) => t.value === status) ? status : ''} onChange={(v) => set('status', v)} />
        <SearchInput value={q} onChange={(v) => set('q', v)} placeholder="Script number, patient or medicine" className="w-80" shortcut="/" />
      </div>
      <Card padded={false}>
        {isLoading ? (
          <Loading />
        ) : !data?.length ? (
          <EmptyState title="Nothing in this stage" description="Scripts appear here as they move through the dispensary." />
        ) : (
          <Table>
            <THead>
              <tr><TH>Script</TH><TH>Patient</TH><TH>Medicine</TH><TH>Type</TH><TH>Prescriber</TH><TH>Status</TH><TH align="right">Patient pays</TH><TH align="right">Updated</TH></tr>
            </THead>
            <tbody>
              {data.map((s) => (
                <TR key={s.id} onClick={() => router.push(`/dispense/scripts/${s.id}`)}>
                  <TD mono>
                    {s.number}
                    {s.supplyNo > 0 && <div className="text-[10px] text-ink-400">Repeat {s.supplyNo}/{s.repeatsTotal}</div>}
                  </TD>
                  <TD>
                    <div className="font-medium text-ink-900">{s.patient.lastName.toUpperCase()}, {s.patient.firstName}</div>
                    {s.patient.concessionType !== 'GENERAL' && <div className="text-xs text-ink-500">{s.patient.concessionType === 'DVA' ? 'DVA' : 'Concession'}</div>}
                  </TD>
                  <TD>
                    <div className="text-ink-900">{s.drug.brandName} {s.drug.strength}</div>
                    <div className="text-xs text-ink-500">{s.drug.genericName} · qty {s.quantity}</div>
                  </TD>
                  <TD>
                    <div className="flex gap-1">
                      <Badge tone={s.scriptType === 'PRIVATE' ? 'neutral' : 'blue'}>{s.scriptType}</Badge>
                      {s.drug.schedule === 'S8' && <Badge tone="red">S8</Badge>}
                      {s.source !== 'PAPER' && <Badge tone="violet">eRx</Badge>}
                    </div>
                  </TD>
                  <TD className="text-ink-600">{s.prescriber.name}</TD>
                  <TD><StatusBadge status={s.status} label={SCRIPT_STATUS_LABEL[s.status]} /></TD>
                  <TD align="right">{money(s.patientPrice)}</TD>
                  <TD align="right" className="text-ink-500">{relative(s.updatedAt)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </PageBody>
  );
}
