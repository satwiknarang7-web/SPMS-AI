'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ClipboardList, Clock, PackageCheck, Pill, PlusCircle, ScanLine } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageBody } from '@/components/layout/AppShell';
import { Button, Card, CardHeader, EmptyState, Kbd, Loading, PageHeader, Stat, StatusBadge, Table, TD, TH, THead, TR } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { SCRIPT_STATUS_LABEL } from '@/features/dispense/shared/types';
import { api } from '@/lib/api';
import { money, relative } from '@/lib/format';
import { useHotkey } from '@/lib/hooks';

export interface Dashboard {
  counts: Record<string, number>;
  dispensedToday: number;
  pbsToday: number;
  recent: { id: string; number: string; status: string; updatedAt: string; patientPrice: number | null; patient: { firstName: string; lastName: string }; drug: { brandName: string; strength: string } }[];
}

export function DispenseDashboard() {
  const router = useRouter();
  const { can, store } = useSession();
  const { data, isLoading } = useQuery({ queryKey: ['dispense', 'dashboard'], queryFn: () => api.get<Dashboard>('/dispense/dashboard'), refetchInterval: 20_000 });
  useHotkey('F2', () => router.push('/dispense/new'), { allowInInputs: true, enabled: can('dispense.scripts.write') });

  const c = data?.counts ?? {};
  return (
    <PageBody>
      <PageHeader
        eyebrow="Dispensary"
        title="Today at the dispensary"
        subtitle={store?.name}
        actions={
          can('dispense.scripts.write') && (
            <Button variant="primary" size="lg" icon={<PlusCircle className="size-4" />} onClick={() => router.push('/dispense/new')}>
              New script <Kbd>F2</Kbd>
            </Button>
          )
        }
      />
      {isLoading || !data ? (
        <Loading />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Link href="/dispense/scripts?status=IN_PROGRESS"><Stat label="In progress" value={c.IN_PROGRESS ?? 0} icon={<ClipboardList />} hint="being prepared" /></Link>
            <Link href="/dispense/scripts?status=AWAITING_CHECK"><Stat label="Awaiting final check" value={c.AWAITING_CHECK ?? 0} icon={<Clock />} tone="amber" hint="pharmacist queue" /></Link>
            <Link href="/dispense/scripts?status=READY"><Stat label="Ready for collection" value={c.READY ?? 0} icon={<PackageCheck />} tone="green" hint="bagged and waiting" /></Link>
            <Stat label="Dispensed today" value={data.dispensedToday} icon={<CheckCircle2 />} hint={`${data.pbsToday} PBS / RPBS`} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
            <Card padded={false}>
              <div className="p-5 pb-0">
                <CardHeader title="Recent activity" subtitle="Latest changes to scripts at this store" actions={<Link href="/dispense/scripts" className="text-sm font-medium text-[var(--accent)]">Open queue →</Link>} />
              </div>
              {data.recent.length === 0 ? (
                <EmptyState title="No scripts yet today" />
              ) : (
                <Table>
                  <THead>
                    <tr><TH>Script</TH><TH>Patient</TH><TH>Medicine</TH><TH>Status</TH><TH align="right">Price</TH><TH align="right">Updated</TH></tr>
                  </THead>
                  <tbody>
                    {data.recent.map((s) => (
                      <TR key={s.id} onClick={() => router.push(`/dispense/scripts/${s.id}`)}>
                        <TD mono>{s.number}</TD>
                        <TD className="font-medium text-ink-900">{s.patient.lastName.toUpperCase()}, {s.patient.firstName}</TD>
                        <TD>{s.drug.brandName} {s.drug.strength}</TD>
                        <TD><StatusBadge status={s.status} label={SCRIPT_STATUS_LABEL[s.status]} /></TD>
                        <TD align="right">{money(s.patientPrice)}</TD>
                        <TD align="right" className="text-ink-500">{relative(s.updatedAt)}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader title="Workflow" subtitle="Receive → verify → dispense → hand out" icon={<Pill />} />
                <ol className="space-y-3 text-sm">
                  {[
                    ['Scan the eRx token or enter the paper script', 'Patient, prescriber and medicine are pre-filled from the token.'],
                    ['Select the pack', 'Brands are ranked by your head-office strategy and stock on hand.'],
                    ['Review safety alerts', 'Allergies, interactions and duplicate therapy surface before check.'],
                    ['Final check with scan', 'Scanning the pack confirms it matches the selected item.'],
                    ['Print label & hand out', 'Payment is taken at POS; the script moves to Collected.'],
                  ].map(([t, d], i) => (
                    <li key={t} className="flex gap-3">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-xs font-bold text-[var(--accent)]">{i + 1}</span>
                      <span><span className="font-medium text-ink-800">{t}</span><span className="block text-xs text-ink-500">{d}</span></span>
                    </li>
                  ))}
                </ol>
              </Card>
              <Card>
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"><ScanLine className="size-5" /></span>
                  <div className="text-sm">
                    <div className="font-semibold text-ink-900">Demo eRx tokens</div>
                    <div className="text-ink-500">Try <code className="font-mono text-xs">2GF7K9QXLM4T</code> (interaction) or <code className="font-mono text-xs">3HD8P2WZRN6V</code> (allergy).</div>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </PageBody>
  );
}
