'use client';

import { useQuery } from '@tanstack/react-query';
import { Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageBody } from '@/components/layout/AppShell';
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Input, Loading, PageHeader, Select, StatusBadge, Table, TD, TH, THead, TR } from '@/components/ui';
import { Customer, CustomerSelect, NeedShift } from '@/features/pos/shared/components';
import { useCurrentShift } from '@/features/pos/shared/shift';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { date, money } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface HireItem { id: string; group: string; name: string; serial: string; weeklyRate: number; deposit: number; status: string }

export interface Contract { id: string; number: string; status: string; startDate: string; dueDate: string; returnedAt: string | null; depositPaid: number; depositRefunded: number | null; hireCharge: number | null; item: HireItem; customer: Customer | null }

export function Hire() {
  const { data: shift } = useCurrentShift();
  const shiftId = shift?.shift?.id;
  const items = useQuery({ queryKey: ['pos', 'hire', 'items'], queryFn: () => api.get<HireItem[]>('/pos/hire/items') });
  const contracts = useQuery({ queryKey: ['pos', 'hire', 'contracts'], queryFn: () => api.get<Contract[]>('/pos/hire/contracts') });
  const [hiring, setHiring] = useState<HireItem | null>(null);
  const [returning, setReturning] = useState<Contract | null>(null);
  const groups = [...new Set(items.data?.map((i) => i.group))];
  return (
    <PageBody>
      <PageHeader title="Equipment hire" subtitle="Crutches, wheelchairs, nebulisers and more — contracts, deposits and returns" />
      {!shiftId && <NeedShift />}
      {items.isLoading ? <Loading /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <Card key={g}>
              <CardHeader title={g} icon={<Wrench />} subtitle={`${items.data!.filter((i) => i.group === g && i.status === 'AVAILABLE').length} available`} />
              <ul className="space-y-2">
                {items.data!.filter((i) => i.group === g).map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0"><span className="block truncate text-ink-800">{i.name}</span><span className="font-mono text-xs text-ink-400">{i.serial} · {money(i.weeklyRate)}/wk · bond {money(i.deposit)}</span></span>
                    {i.status === 'AVAILABLE' && shiftId ? <Button size="xs" onClick={() => setHiring(i)}>Hire out</Button> : <StatusBadge status={i.status} />}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      <Card padded={false} className="mt-6">
        <div className="p-5 pb-0"><CardHeader title="Contracts" /></div>
        {!contracts.data?.length ? <EmptyState title="No hire contracts yet" /> : (
          <Table>
            <THead><tr><TH>Contract</TH><TH>Item</TH><TH>Customer</TH><TH>Started</TH><TH>Due back</TH><TH align="right">Bond</TH><TH>Status</TH><TH /></tr></THead>
            <tbody>
              {contracts.data.map((c) => (
                <TR key={c.id}>
                  <TD mono>{c.number}</TD>
                  <TD>{c.item.name}<span className="block font-mono text-xs text-ink-400">{c.item.serial}</span></TD>
                  <TD>{c.customer?.name}</TD>
                  <TD>{date(c.startDate)}</TD>
                  <TD className={cn(c.status === 'ACTIVE' && new Date(c.dueDate) < new Date() && 'font-semibold text-rose-600')}>{date(c.dueDate)}</TD>
                  <TD align="right">{money(c.depositPaid)}{c.depositRefunded != null && <span className="block text-xs text-ink-500">refunded {money(c.depositRefunded)}</span>}</TD>
                  <TD><StatusBadge status={c.status} /></TD>
                  <TD align="right">{c.status === 'ACTIVE' && shiftId && <Button size="sm" onClick={() => setReturning(c)}>Return</Button>}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {shiftId && <HireDialog item={hiring} shiftId={shiftId} onClose={() => setHiring(null)} />}
      {shiftId && <ReturnDialog contract={returning} shiftId={shiftId} onClose={() => setReturning(null)} />}
    </PageBody>
  );
}

export function HireDialog({ item, shiftId, onClose }: { item: HireItem | null; shiftId: string; onClose: () => void }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [weeks, setWeeks] = useState('2');
  const [notes, setNotes] = useState('');
  useEffect(() => { if (item) { setCustomer(null); setWeeks('2'); setNotes(''); } }, [item]);
  const save = useAction(() => api.post('/pos/hire/contracts', { shiftId, hireItemId: item!.id, customerId: customer!.id, weeks: Number(weeks), notes }), { success: 'Hire contract created — bond taken', invalidate: [['pos', 'hire']], onSuccess: onClose });
  return (
    <Dialog open={!!item} onClose={onClose} title={`Hire out ${item?.name}`} description={item && `${item.serial} · ${money(item.weeklyRate)} per week · bond ${money(item.deposit)}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!customer} loading={save.isPending} onClick={() => save.mutate(undefined)}>Create contract</Button></>}>
      <div className="grid gap-4">
        <Field label="Customer"><CustomerSelect value={customer} onChange={setCustomer} /></Field>
        <Field label="Hire period (weeks)"><Input type="number" min={1} value={weeks} onChange={(e) => setWeeks(e.target.value)} /></Field>
        <Field label="Condition notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Minor scuff on left armrest" /></Field>
        {item && <div className="rounded-lg bg-ink-50 p-3 text-sm">Collect bond now: <strong>{money(item.deposit)}</strong>. Hire charges are deducted from the bond on return.</div>}
      </div>
    </Dialog>
  );
}

export function ReturnDialog({ contract, shiftId, onClose }: { contract: Contract | null; shiftId: string; onClose: () => void }) {
  const [condition, setCondition] = useState<'GOOD' | 'NEEDS_SERVICE'>('GOOD');
  const [notes, setNotes] = useState('');
  const weeks = contract ? Math.max(1, Math.ceil((Date.now() - new Date(contract.startDate).getTime()) / (7 * 86_400_000))) : 0;
  const charge = contract ? weeks * contract.item.weeklyRate : 0;
  const save = useAction(() => api.post(`/pos/hire/contracts/${contract!.id}/return`, { shiftId, condition, notes }), { success: 'Return processed', invalidate: [['pos', 'hire']], onSuccess: onClose });
  return (
    <Dialog open={!!contract} onClose={onClose} title={`Return ${contract?.item.name}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Process return</Button></>}>
      {contract && (
        <div className="grid gap-4">
          <div className="rounded-lg bg-ink-50 p-3 text-sm">
            <div className="flex justify-between"><span>{weeks} week(s) × {money(contract.item.weeklyRate)}</span><span className="tnum">{money(charge)}</span></div>
            <div className="flex justify-between"><span>Bond held</span><span className="tnum">{money(contract.depositPaid)}</span></div>
            <div className="mt-1 flex justify-between border-t border-ink-200 pt-1 font-semibold">
              <span>{charge > contract.depositPaid ? 'Customer owes' : 'Refund bond'}</span><span className="tnum">{money(Math.abs(contract.depositPaid - charge))}</span>
            </div>
          </div>
          <Field label="Condition">
            <Select value={condition} onChange={(e) => setCondition(e.target.value as 'GOOD')}><option value="GOOD">Good — available for hire</option><option value="NEEDS_SERVICE">Needs service</option></Select>
          </Field>
          <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          {condition === 'NEEDS_SERVICE' && <Badge tone="amber">Item will be placed in maintenance</Badge>}
        </div>
      )}
    </Dialog>
  );
}
