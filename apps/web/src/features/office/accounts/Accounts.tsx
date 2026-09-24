'use client';

import { useQuery } from '@tanstack/react-query';
import { CreditCard, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageBody } from '@/components/layout/AppShell';
import { Button, Card, Dialog, EmptyState, Field, Input, Loading, PageHeader, ProgressBar, SearchInput, Stat, Table, TD, TH, THead, TR } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { Account } from '@/features/office/shared/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { money, parseMoney } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export function Accounts() {
  const router = useRouter();
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [opening, setOpening] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['office', 'accounts', q], queryFn: () => api.get<Account[]>('/office/accounts', { q }) });
  const fees = useAction(() => api.post<{ applied: number }>('/office/accounts/apply-fees'), { success: (r) => `Monthly fees applied to ${r.applied} account(s)`, invalidate: [['office', 'accounts']] });
  const owed = data?.reduce((s, a) => s + a.balance, 0) ?? 0;
  return (
    <PageBody>
      <PageHeader title="Customer accounts" subtitle="Credit customers purchasing against a running balance" actions={can('office.accounts.write') && <>
        <Button onClick={() => fees.mutate(undefined)} loading={fees.isPending}>Apply monthly fees</Button>
        <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setOpening(true)}>Open account</Button>
      </>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Accounts" value={data?.length ?? 0} icon={<CreditCard />} />
        <Stat label="Total owed" value={money(owed)} tone="amber" />
        <Stat label="Over 80% of limit" value={data?.filter((a) => a.creditLimit && a.balance / a.creditLimit > 0.8).length ?? 0} tone="red" />
      </div>
      <SearchInput value={q} onChange={setQ} placeholder="Search accounts" className="mb-4 max-w-sm" />
      <Card padded={false}>
        {isLoading ? <Loading /> : !data?.length ? <EmptyState title="No accounts" /> : (
          <Table>
            <THead><tr><TH>Account</TH><TH>Linked patient</TH><TH>Contact</TH><TH>Credit used</TH><TH align="right">Monthly fee</TH><TH align="right">Balance</TH></tr></THead>
            <tbody>
              {data.map((a) => (
                <TR key={a.id} onClick={() => router.push(`/office/accounts/${a.id}`)}>
                  <TD className="font-medium text-ink-900">{a.name}</TD>
                  <TD className="text-ink-600">{a.patient ? `${a.patient.firstName} ${a.patient.lastName}` : '—'}</TD>
                  <TD className="text-ink-500">{a.phone}</TD>
                  <TD className="w-48">{a.creditLimit ? <><ProgressBar value={a.balance} max={a.creditLimit} tone={a.balance / a.creditLimit > 0.8 ? '#e11d48' : undefined} /><span className="text-xs text-ink-500">of {money(a.creditLimit)}</span></> : <span className="text-ink-400">No limit</span>}</TD>
                  <TD align="right">{a.accountFee ? money(a.accountFee) : '—'}</TD>
                  <TD align="right" className={cn('font-semibold', a.balance > 0 ? 'text-ink-900' : 'text-emerald-700')}>{money(a.balance)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <OpenAccountDialog open={opening} onClose={() => setOpening(false)} />
    </PageBody>
  );
}

export function OpenAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ name: '', email: '', phone: '', creditLimit: '500.00', accountFee: '0.00' });
  useEffect(() => { if (open) setF({ name: '', email: '', phone: '', creditLimit: '500.00', accountFee: '0.00' }); }, [open]);
  const save = useAction(() => api.post('/office/accounts', { ...f, creditLimit: parseMoney(f.creditLimit) ?? 0, accountFee: parseMoney(f.accountFee) ?? 0 }), { success: 'Account opened', invalidate: [['office', 'accounts']], onSuccess: onClose });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Dialog open={open} onClose={onClose} title="Open customer account" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={f.name.length < 2} loading={save.isPending} onClick={() => save.mutate(undefined)}>Open account</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Account name" className="sm:col-span-2" required><Input value={f.name} onChange={set('name')} placeholder="Person or organisation (e.g. aged care facility)" /></Field>
        <Field label="Email"><Input value={f.email} onChange={set('email')} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Credit limit"><Input value={f.creditLimit} onChange={set('creditLimit')} /></Field>
        <Field label="Monthly account fee"><Input value={f.accountFee} onChange={set('accountFee')} /></Field>
      </div>
    </Dialog>
  );
}
