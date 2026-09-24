'use client';

import { useQuery } from '@tanstack/react-query';
import { ClipboardList, PlusCircle, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageBody } from '@/components/layout/AppShell';
import { Button, Card, ConfirmDialog, Dialog, EmptyState, Field, Input, Loading, PageHeader, ProgressBar, SearchInput, Select, StatusBadge, Table, TD, TH, THead, TR } from '@/components/ui';
import { Customer, CustomerSelect, NeedShift } from '@/features/pos/shared/components';
import { useCurrentShift } from '@/features/pos/shared/shift';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { date, dollars, money, parseMoney } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface Product { id: string; name: string; retailPrice: number; category: string }

export interface Layby { id: string; number: string; total: number; paid: number; status: string; dueDate: string; createdAt: string; items: { description: string; quantity: number; unitPrice: number }[]; customer: Customer | null }

export function Laybys() {
  const { data: shift } = useCurrentShift();
  const { data, isLoading } = useQuery({ queryKey: ['pos', 'laybys'], queryFn: () => api.get<Layby[]>('/pos/laybys') });
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<Layby | null>(null);
  const [cancelling, setCancelling] = useState<Layby | null>(null);
  const shiftId = shift?.shift?.id;
  const cancel = useAction(({ id, reason }: { id: string; reason: string }) => api.post(`/pos/laybys/${id}/cancel`, { shiftId, reason }), { success: 'Layby cancelled and stock returned', invalidate: [['pos']], onSuccess: () => setCancelling(null) });
  return (
    <PageBody>
      <PageHeader title="Laybys" subtitle="Goods set aside against instalment payments" actions={<Button variant="primary" icon={<PlusCircle className="size-4" />} disabled={!shiftId} onClick={() => setCreating(true)}>New layby</Button>} />
      {!shiftId && <NeedShift />}
      <Card padded={false}>
        {isLoading ? <Loading /> : !data?.length ? <EmptyState icon={<ClipboardList />} title="No laybys" /> : (
          <Table>
            <THead><tr><TH>Layby</TH><TH>Customer</TH><TH>Items</TH><TH>Progress</TH><TH>Due</TH><TH>Status</TH><TH /></tr></THead>
            <tbody>
              {data.map((l) => (
                <TR key={l.id}>
                  <TD mono>{l.number}</TD>
                  <TD className="font-medium text-ink-900">{l.customer?.name}</TD>
                  <TD className="text-ink-600">{l.items.map((i) => i.description).join(', ')}</TD>
                  <TD className="w-56">
                    <div className="mb-1 flex justify-between text-xs"><span>{money(l.paid)} paid</span><span className="text-ink-500">{money(l.total)}</span></div>
                    <ProgressBar value={l.paid} max={l.total} />
                  </TD>
                  <TD className={cn(new Date(l.dueDate) < new Date() && l.status === 'ACTIVE' && 'font-semibold text-rose-600')}>{date(l.dueDate)}</TD>
                  <TD><StatusBadge status={l.status} label={l.status === 'COMPLETED' ? 'Paid — ready for pickup' : undefined} /></TD>
                  <TD align="right">
                    {l.status === 'ACTIVE' && shiftId && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" onClick={() => setPaying(l)}>Payment</Button>
                        <Button size="sm" variant="ghost" onClick={() => setCancelling(l)}>Cancel</Button>
                      </div>
                    )}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {shiftId && <NewLayby open={creating} shiftId={shiftId} onClose={() => setCreating(false)} />}
      {shiftId && <LaybyPayment layby={paying} shiftId={shiftId} onClose={() => setPaying(null)} />}
      <ConfirmDialog open={!!cancelling} onClose={() => setCancelling(null)} title={`Cancel ${cancelling?.number}?`} description="Payments are refunded in cash and the goods return to stock." requireReason tone="danger" confirmLabel="Cancel layby" loading={cancel.isPending} onConfirm={(reason) => cancelling && cancel.mutate({ id: cancelling.id, reason })} />
    </PageBody>
  );
}

export function NewLayby({ open, shiftId, onClose }: { open: boolean; shiftId: string; onClose: () => void }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [items, setItems] = useState<(Product & { quantity: number })[]>([]);
  const [q, setQ] = useState('');
  const [deposit, setDeposit] = useState('');
  const [weeks, setWeeks] = useState('8');
  useEffect(() => { if (open) { setCustomer(null); setItems([]); setDeposit(''); } }, [open]);
  const { data: products } = useQuery({ queryKey: ['catalogue', q], queryFn: () => api.get<Product[]>('/platform/catalogue/products', { q, take: 12 }), enabled: q.length >= 2 });
  const total = items.reduce((s, i) => s + i.retailPrice * i.quantity, 0);
  useEffect(() => setDeposit(total ? dollars(Math.ceil(total * 0.2)) : ''), [total]);
  const save = useAction(() => api.post('/pos/laybys', { shiftId, customerId: customer!.id, items: items.map((i) => ({ productId: i.id, quantity: i.quantity })), deposit: parseMoney(deposit), weeks: Number(weeks) }), { success: 'Layby opened — goods set aside', invalidate: [['pos']], onSuccess: onClose });
  return (
    <Dialog open={open} onClose={onClose} size="lg" title="New layby" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!customer || !items.length || !parseMoney(deposit)} loading={save.isPending} onClick={() => save.mutate(undefined)}>Open layby</Button></>}>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <Field label="Customer"><CustomerSelect value={customer} onChange={setCustomer} /></Field>
          <Field label="Add items" className="mt-4">
            <SearchInput value={q} onChange={setQ} placeholder="Search products" />
          </Field>
          <div className="mt-1 max-h-48 overflow-y-auto rounded-lg ring-1 ring-ink-200">
            {products?.filter((p) => p.category !== 'Prescription').map((p) => (
              <button key={p.id} onClick={() => setItems((xs) => (xs.some((x) => x.id === p.id) ? xs : [...xs, { ...p, quantity: 1 }]))} className="flex w-full justify-between px-3 py-1.5 text-left text-sm hover:bg-ink-50"><span className="truncate">{p.name}</span><span className="tnum">{money(p.retailPrice)}</span></button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[13px] font-medium text-ink-700">Items</div>
          <ul className="mt-2 space-y-1.5">
            {items.map((i) => (
              <li key={i.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">{i.name}</span>
                <Input type="number" min={1} value={i.quantity} onChange={(e) => setItems((xs) => xs.map((x) => (x.id === i.id ? { ...x, quantity: Math.max(1, Number(e.target.value)) } : x)))} className="w-16" />
                <Button size="xs" variant="ghost" onClick={() => setItems((xs) => xs.filter((x) => x.id !== i.id))}><Trash2 className="size-3.5" /></Button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-between border-t border-ink-200 pt-2 font-semibold"><span>Total</span><span className="tnum">{money(total)}</span></div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Deposit (cash)" hint="Minimum 10%"><Input value={deposit} onChange={(e) => setDeposit(e.target.value)} /></Field>
            <Field label="Term">
              <Select value={weeks} onChange={(e) => setWeeks(e.target.value)}>{[4, 6, 8, 12, 16].map((w) => <option key={w} value={w}>{w} weeks</option>)}</Select>
            </Field>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

export function LaybyPayment({ layby, shiftId, onClose }: { layby: Layby | null; shiftId: string; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  useEffect(() => { if (layby) setAmount(dollars(layby.total - layby.paid)); }, [layby]);
  const pay = useAction(() => api.post(`/pos/laybys/${layby!.id}/payment`, { shiftId, amount: parseMoney(amount) }), { success: 'Payment recorded', invalidate: [['pos']], onSuccess: onClose });
  return (
    <Dialog open={!!layby} onClose={onClose} size="sm" title={`Payment — ${layby?.number}`} description={layby && `Balance ${money(layby.total - layby.paid)}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={pay.isPending} disabled={!parseMoney(amount)} onClick={() => pay.mutate(undefined)}>Take payment</Button></>}>
      <Field label="Amount (cash)"><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></Field>
    </Dialog>
  );
}
