'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ClipboardList, Clock, Copy, PackageCheck, Pill, PlusCircle, ScanLine, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageBody } from '@/components/layout/AppShell';
import { toast } from 'sonner';
import { Badge, Button, Card, CardHeader, EmptyState, IconButton, Kbd, Loading, PageHeader, Stat, StatusBadge, Table, TD, TH, THead, TR } from '@/components/ui';
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

const WORKFLOW = [
  ['Scan the eRx token or enter the paper script', 'Patient, prescriber and medicine are pre-filled from the token.'],
  ['Select the pack', 'Brands are ranked by your head-office strategy and stock on hand.'],
  ['Review safety alerts', 'Allergies, interactions and duplicate therapy surface before check.'],
  ['Final check with scan', 'Scanning the pack confirms it matches the selected item.'],
  ['Print label & hand out', 'Payment is taken at POS; the script moves to Collected.'],
] as const;

const DEMO_TOKENS = [
  ['2GF7K9QXLM4T', 'Triggers an interaction alert'],
  ['3HD8P2WZRN6V', 'Triggers an allergy alert'],
] as const;

const SAFETY = ['Allergy and adverse-reaction screening', 'Drug interaction checks', 'Duplicate therapy detection', 'PBS safety net tracking', 'Barcode verification at final check'];

export function DispenseDashboard() {
  const router = useRouter();
  const { can, store } = useSession();
  const { data, isLoading } = useQuery({ queryKey: ['dispense', 'dashboard'], queryFn: () => api.get<Dashboard>('/dispense/dashboard'), refetchInterval: 20_000 });
  useHotkey('F2', () => router.push('/dispense/new'), { allowInInputs: true, enabled: can('dispense.scripts.write') });

  const c = data?.counts ?? {};
  return (
    <PageBody>
      <PageHeader
        eyebrow="Dispensary • Live sync"
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
            <Link href="/dispense/scripts?status=IN_PROGRESS"><Stat label="In progress" value={c.IN_PROGRESS ?? 0} icon={<ClipboardList />} tone="blue" hint="being prepared" /></Link>
            <Link href="/dispense/scripts?status=AWAITING_CHECK"><Stat label="Awaiting final check" value={c.AWAITING_CHECK ?? 0} icon={<Clock />} tone="amber" hint="pharmacist queue" /></Link>
            <Link href="/dispense/scripts?status=READY"><Stat label="Ready for collection" value={c.READY ?? 0} icon={<PackageCheck />} tone="green" hint="bagged and waiting" /></Link>
            <Stat label="Dispensed today" value={data.dispensedToday} icon={<CheckCircle2 />} tone="violet" hint={`${data.pbsToday} PBS / RPBS`} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
            <Card padded={false}>
              <div className="p-6 pb-2">
                <CardHeader title="Recent activity" subtitle="Latest changes to scripts at this store" actions={<Link href="/dispense/scripts" className="text-sm font-semibold text-primary-700 hover:text-primary-800">Open queue →</Link>} />
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
                <ol className="relative space-y-4 text-sm before:absolute before:top-3 before:bottom-3 before:left-[13px] before:w-px before:bg-[var(--line)]">
                  {WORKFLOW.map(([t, d], i) => (
                    <li key={t} className="relative flex gap-3">
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-tertiary-50 text-xs font-bold text-tertiary-600 ring-4 ring-white">{i + 1}</span>
                      <span className="pt-0.5"><span className="font-semibold text-ink-800">{t}</span><span className="mt-0.5 block text-xs text-ink-500">{d}</span></span>
                    </li>
                  ))}
                </ol>
              </Card>
              <Card>
                <CardHeader title="Demo eRx tokens" subtitle="Scan or paste into New script" icon={<ScanLine />} />
                <div className="space-y-2">
                  {DEMO_TOKENS.map(([token, note]) => (
                    <div key={token} className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-ink-50/60 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <code className="font-mono text-[13px] font-semibold text-ink-900">{token}</code>
                        <div className="text-xs text-ink-500">{note}</div>
                      </div>
                      <IconButton
                        label={`Copy ${token}`}
                        tone="neutral"
                        onClick={() => {
                          navigator.clipboard?.writeText(token).then(() => toast.success('Token copied'), () => toast.error('Clipboard unavailable'));
                        }}
                      >
                        <Copy />
                      </IconButton>
                    </div>
                  ))}
                </div>
              </Card>
              <Card>
                <CardHeader title="Dispensary safety net" icon={<ShieldCheck />} actions={<Badge tone="green" dot>Operational</Badge>} />
                <ul className="space-y-2.5 text-sm">
                  {SAFETY.map((s) => (
                    <li key={s} className="flex items-center gap-2.5 text-ink-700">
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                      {s}
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
        </>
      )}
    </PageBody>
  );
}
