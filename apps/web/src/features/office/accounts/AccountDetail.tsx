'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageBody } from '@/components/layout/AppShell';
import { Badge, Button, Card, CardHeader, Dialog, Field, Input, Loading, NotFound, PageHeader, Select, Stat, Table, TD, TH, THead, TR } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { Accounts } from '@/features/office/accounts/Accounts';
import { Account } from '@/features/office/shared/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { date, dateTime, money, parseMoney } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface AccountDetailData extends Account { transactions: { id: string; type: string; amount: number; note: string | null; createdAt: string }[] }

export function AccountDetail() {
  const { id } = useParams<{ id: string }>();
  const { can, session } = useSession();
  const [txn, setTxn] = useState<null | 'PAYMENT' | 'FEE' | 'ADJUSTMENT'>(null);
  const [statement, setStatement] = useState(false);
  const { data: a, isLoading } = useQuery({ queryKey: ['office', 'account', id], queryFn: () => api.get<AccountDetailData>(`/office/accounts/${id}`) });
  if (isLoading) return <Loading />;
  if (!a) return <NotFound what="account" />;
  const statementDoc = (
    <div className="bg-white p-8 text-sm text-black">
      <div className="flex justify-between"><div><div className="text-xl font-bold">Statement of account</div><div>{session?.tenant?.name}</div></div><div className="text-right">{date(new Date())}</div></div>
      <div className="mt-6 font-semibold">{a.name}</div><div>{a.email}</div>
      <table className="mt-6 w-full text-left"><thead><tr className="border-b border-black"><th className="py-1">Date</th><th>Details</th><th className="text-right">Amount</th></tr></thead>
        <tbody>{a.transactions.slice().reverse().map((t) => <tr key={t.id} className="border-b border-gray-200"><td className="py-1">{date(t.createdAt)}</td><td>{t.type.toLowerCase()} {t.note && `— ${t.note}`}</td><td className="text-right">{money(t.amount)}</td></tr>)}</tbody>
      </table>
      <div className="mt-4 text-right text-lg font-bold">Balance owing {money(a.balance)}</div>
    </div>
  );
  return (
    <PageBody>
      <PageHeader back={<Link href="/office/accounts" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800"><ArrowLeft className="size-4" /> Accounts</Link>} title={a.name}
        subtitle={a.patient ? `Linked to patient ${a.patient.firstName} ${a.patient.lastName}` : a.email ?? undefined}
        actions={<>
          <Button icon={<Printer className="size-4" />} onClick={() => setStatement(true)}>Statement</Button>
          {can('office.accounts.write') && <><Button onClick={() => setTxn('FEE')}>Add fee</Button><Button onClick={() => setTxn('ADJUSTMENT')}>Adjust</Button><Button variant="primary" onClick={() => setTxn('PAYMENT')}>Record payment</Button></>}
        </>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Balance owing" value={money(a.balance)} tone={a.balance > 0 ? 'amber' : 'green'} />
        <Stat label="Credit limit" value={a.creditLimit ? money(a.creditLimit) : 'None'} hint={a.creditLimit ? `${money(a.creditLimit - a.balance)} available` : undefined} />
        <Stat label="Monthly fee" value={money(a.accountFee)} />
      </div>
      <Card padded={false}>
        <div className="p-5 pb-0"><CardHeader title="Transactions" /></div>
        <Table>
          <THead><tr><TH>Date</TH><TH>Type</TH><TH>Details</TH><TH align="right">Amount</TH></tr></THead>
          <tbody>
            {a.transactions.map((t) => (
              <TR key={t.id}><TD className="text-ink-500">{dateTime(t.createdAt)}</TD><TD><Badge tone={t.type === 'PAYMENT' ? 'green' : t.type === 'CHARGE' ? 'blue' : 'neutral'}>{t.type.toLowerCase()}</Badge></TD><TD className="text-ink-600">{t.note}</TD><TD align="right" className={cn('font-medium', t.amount < 0 && 'text-emerald-700')}>{money(t.amount)}</TD></TR>
            ))}
          </tbody>
        </Table>
      </Card>
      <TxnDialog type={txn} accountId={a.id} onClose={() => setTxn(null)} />
      <Dialog open={statement} onClose={() => setStatement(false)} size="lg" title="Statement" footer={<Button variant="primary" icon={<Printer className="size-4" />} onClick={() => window.print()}>Print</Button>}>{statementDoc}</Dialog>
      {statement && createPortal(<div className="print-only">{statementDoc}</div>, document.body)}
    </PageBody>
  );
}

export function TxnDialog({ type, accountId, onClose }: { type: null | 'PAYMENT' | 'FEE' | 'ADJUSTMENT'; accountId: string; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [direction, setDirection] = useState('CREDIT');
  useEffect(() => { if (type) { setAmount(''); setNote(type === 'PAYMENT' ? 'Payment received' : ''); } }, [type]);
  const save = useAction(() => api.post(`/office/accounts/${accountId}/transaction`, { type, amount: parseMoney(amount), note, direction }), { success: 'Recorded', invalidate: [['office']], onSuccess: onClose });
  return (
    <Dialog open={!!type} onClose={onClose} size="sm" title={{ PAYMENT: 'Record payment', FEE: 'Add fee', ADJUSTMENT: 'Adjust balance' }[type ?? 'PAYMENT']}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!parseMoney(amount) || note.length < 2} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-3">
        <Field label="Amount"><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></Field>
        {type === 'ADJUSTMENT' && <Field label="Direction"><Select value={direction} onChange={(e) => setDirection(e.target.value)}><option value="CREDIT">Credit (reduce balance)</option><option value="DEBIT">Debit (increase balance)</option></Select></Field>}
        <Field label="Note" required><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
