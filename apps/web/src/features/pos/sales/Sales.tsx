'use client';

import { useQuery } from '@tanstack/react-query';
import { Printer, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { PageBody } from '@/components/layout/AppShell';
import { Alert, Badge, Button, Card, Checkbox, Dialog, Drawer, EmptyState, Field, Input, Loading, PageHeader, SearchInput, Select, StatusBadge, Table, TD, TH, THead, TR } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { Receipt, type SaleDetail, useCurrentShift } from '@/features/pos/shared/shift';
import { api } from '@/lib/api';
import { dateTime, money } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface SaleRow { id: string; number: string; type: string; status: string; total: number; createdAt: string; payments: { tender: string }[]; _count: { lines: number } }

export function Sales() {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['pos', 'sales', q], queryFn: () => api.get<SaleRow[]>('/pos/sales', { q, take: 100 }) });
  return (
    <PageBody>
      <PageHeader title="Sales & returns" subtitle="Find a receipt to reprint it or process a return" />
      <SearchInput value={q} onChange={setQ} placeholder="Receipt number, e.g. S0001234" className="mb-4 max-w-sm" />
      <Card padded={false}>
        {isLoading ? <Loading /> : !data?.length ? <EmptyState title="No sales found" /> : (
          <Table>
            <THead><tr><TH>Receipt</TH><TH>Time</TH><TH>Type</TH><TH>Items</TH><TH>Tender</TH><TH>Status</TH><TH align="right">Total</TH></tr></THead>
            <tbody>
              {data.map((s) => (
                <TR key={s.id} onClick={() => setSelected(s.id)}>
                  <TD mono>{s.number}</TD>
                  <TD className="text-ink-500">{dateTime(s.createdAt)}</TD>
                  <TD>{s.type === 'RETURN' ? <Badge tone="red">Return</Badge> : <Badge>Sale</Badge>}</TD>
                  <TD>{s._count.lines}</TD>
                  <TD className="text-ink-600">{[...new Set(s.payments.map((p) => p.tender))].join(' + ')}</TD>
                  <TD><StatusBadge status={s.status} /></TD>
                  <TD align="right" className="font-semibold text-ink-900">{money(s.total)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <SaleDrawer id={selected} onClose={() => setSelected(null)} />
    </PageBody>
  );
}

export function SaleDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { can } = useSession();
  const [refunding, setRefunding] = useState(false);
  const [printing, setPrinting] = useState(false);
  const { data } = useQuery({ queryKey: ['pos', 'sale', id], queryFn: () => api.get<SaleDetail & { refunds: { id: string; number: string; total: number }[] }>(`/pos/sales/${id}`), enabled: !!id });
  useEffect(() => {
    if (!printing) return;
    const t = setTimeout(() => { window.print(); setPrinting(false); }, 50);
    return () => clearTimeout(t);
  }, [printing]);
  const refundable = data?.type === 'SALE' && data.lines.some((l) => !l.prescriptionId && l.refundedQty < l.quantity);
  return (
    <Drawer open={!!id} onClose={onClose} title={data ? `Receipt ${data.number}` : 'Receipt'} footer={data && (
      <>
        <Button icon={<Printer className="size-4" />} onClick={() => setPrinting(true)}>Reprint</Button>
        {refundable && can('pos.refund') && <Button variant="primary" icon={<RotateCcw className="size-4" />} onClick={() => setRefunding(true)}>Return items</Button>}
      </>
    )}>
      {!data ? <Loading /> : (
        <>
          {data.refunds.length > 0 && <Alert tone="amber" className="mb-4" title="Returns processed">{data.refunds.map((r) => `${r.number} (${money(r.total)})`).join(', ')}</Alert>}
          <div className="rounded-xl bg-ink-50 py-4"><Receipt sale={data} /></div>
          {printing && createPortal(<div className="print-only"><Receipt sale={data} /></div>, document.body)}
          <RefundDialog sale={data} open={refunding} onClose={() => setRefunding(false)} />
        </>
      )}
    </Drawer>
  );
}

export function RefundDialog({ sale, open, onClose }: { sale: SaleDetail; open: boolean; onClose: () => void }) {
  const { data: shift } = useCurrentShift();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [tender, setTender] = useState('CASH');
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  useEffect(() => {
    if (open) { setQty({}); setReason(''); setRestock(true); setTender(sale.payments[0]?.tender === 'EFTPOS' ? 'EFTPOS' : 'CASH'); }
  }, [open, sale]);
  const lines = sale.lines.filter((l) => !l.prescriptionId && l.refundedQty < l.quantity);
  const total = lines.reduce((s, l) => s + Math.round(l.lineTotal / l.quantity) * (qty[l.id] ?? 0), 0);
  const refund = useAction(
    () => api.post(`/pos/sales/${sale.id}/refund`, { shiftId: shift?.shift?.id, tender, reason, restock, lines: Object.entries(qty).filter(([, n]) => n > 0).map(([lineId, quantity]) => ({ lineId, quantity })) }),
    { success: 'Return processed', invalidate: [['pos']], onSuccess: onClose },
  );
  return (
    <Dialog open={open} onClose={onClose} size="lg" title={`Return against ${sale.number}`} description="Dispensed prescription medicines can't be returned at the register."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!total || reason.length < 3 || !shift?.shift} loading={refund.isPending} onClick={() => refund.mutate(undefined)}>Refund {money(total)}</Button></>}>
      {!shift?.shift && <Alert tone="red" className="mb-3">Open a shift on this register to process returns.</Alert>}
      <Table>
        <THead><tr><TH>Item</TH><TH align="right">Paid each</TH><TH align="right">Returnable</TH><TH align="right">Return qty</TH></tr></THead>
        <tbody>
          {lines.map((l) => (
            <TR key={l.id}>
              <TD>{l.description}</TD>
              <TD align="right">{money(Math.round(l.lineTotal / l.quantity))}</TD>
              <TD align="right">{l.quantity - l.refundedQty}</TD>
              <TD align="right"><Input type="number" min={0} max={l.quantity - l.refundedQty} value={qty[l.id] ?? 0} onChange={(e) => setQty({ ...qty, [l.id]: Math.min(l.quantity - l.refundedQty, Math.max(0, Number(e.target.value))) })} className="ml-auto w-20 text-right" /></TD>
            </TR>
          ))}
        </tbody>
      </Table>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Refund to">
          <Select value={tender} onChange={(e) => setTender(e.target.value)}>
            <option value="CASH">Cash</option><option value="EFTPOS">EFTPOS (original card)</option><option value="STORE_CREDIT">Store credit</option><option value="ACCOUNT">Customer account</option>
          </Select>
        </Field>
        <Field label="Reason" required><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Change of mind, faulty" /></Field>
      </div>
      <div className="mt-3"><Checkbox label="Return items to saleable stock (untick for faulty goods)" checked={restock} onChange={setRestock} /></div>
    </Dialog>
  );
}
