'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, PackageCheck, Send, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageBody } from '@/components/layout/AppShell';
import { Button, Card, CardHeader, ConfirmDialog, DescriptionList, Dialog, Field, Input, Loading, NotFound, PageHeader, StatusBadge, Table, TD, TH, THead, TR } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { Supplier } from '@/features/office/shared/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { date, dateTime, dollars, money, parseMoney } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface OrderDetailData {
  id: string; number: string; status: string; source: string; createdAt: string; submittedAt: string | null; expectedAt: string | null; notes: string | null;
  supplier: { name: string; electronic: boolean; accountNo: string | null };
  lines: { id: string; productId: string; qtyOrdered: number; qtyReceived: number; unitCost: number; product: { name: string; sku: string; barcode: string | null } | null }[];
  receipts: { id: string; invoiceNo: string | null; receivedAt: string; lines: { quantity: number }[] }[];
}

export function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const [receiving, setReceiving] = useState(false);
  const [cancel, setCancel] = useState(false);
  const { data: o, isLoading } = useQuery({ queryKey: ['office', 'order', id], queryFn: () => api.get<OrderDetailData>(`/office/orders/${id}`) });
  const submit = useAction(() => api.post(`/office/orders/${id}/submit`), { success: 'Order submitted to supplier', invalidate: [['office']] });
  const cancelOrder = useAction(() => api.post(`/office/orders/${id}/cancel`), { success: 'Order cancelled', invalidate: [['office']], onSuccess: () => setCancel(false) });
  if (isLoading) return <Loading />;
  if (!o) return <NotFound what="purchase order" />;
  const total = o.lines.reduce((s, l) => s + l.qtyOrdered * l.unitCost, 0);
  return (
    <PageBody>
      <PageHeader
        back={<Link href="/office/orders" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800"><ArrowLeft className="size-4" /> Purchasing</Link>}
        title={<span className="flex items-center gap-3">{o.number}<StatusBadge status={o.status} /></span>}
        subtitle={`${o.supplier.name} · ${money(total)} at cost`}
        actions={can('office.purchasing.write') && <>
          {['DRAFT', 'SUBMITTED'].includes(o.status) && <Button variant="ghost" icon={<XCircle className="size-4" />} onClick={() => setCancel(true)}>Cancel order</Button>}
          {o.status === 'DRAFT' && <Button variant="primary" icon={<Send className="size-4" />} loading={submit.isPending} onClick={() => submit.mutate(undefined)}>Submit to supplier</Button>}
          {['SUBMITTED', 'PARTIALLY_RECEIVED'].includes(o.status) && <Button variant="primary" icon={<PackageCheck className="size-4" />} onClick={() => setReceiving(true)}>Receive goods</Button>}
        </>}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card padded={false}>
          <Table>
            <THead><tr><TH>Product</TH><TH align="right">Ordered</TH><TH align="right">Received</TH><TH align="right">Unit cost</TH><TH align="right">Line total</TH></tr></THead>
            <tbody>
              {o.lines.map((l) => (
                <TR key={l.id}>
                  <TD className="text-ink-900">{l.product?.name}<span className="block font-mono text-xs text-ink-400">{l.product?.sku}</span></TD>
                  <TD align="right">{l.qtyOrdered}</TD>
                  <TD align="right" className={cn(l.qtyReceived >= l.qtyOrdered ? 'text-emerald-700' : l.qtyReceived > 0 && 'text-amber-700')}>{l.qtyReceived}</TD>
                  <TD align="right">{money(l.unitCost)}</TD>
                  <TD align="right" className="font-medium">{money(l.qtyOrdered * l.unitCost)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Order" />
            <DescriptionList columns={1} items={[
              { label: 'Supplier', value: `${o.supplier.name}${o.supplier.accountNo ? ` · ${o.supplier.accountNo}` : ''}` },
              { label: 'Channel', value: o.supplier.electronic ? 'Electronic gateway' : 'Manual (email / phone)' },
              { label: 'Created', value: dateTime(o.createdAt) }, { label: 'Submitted', value: dateTime(o.submittedAt) }, { label: 'Expected', value: date(o.expectedAt) },
            ]} />
          </Card>
          {o.receipts.length > 0 && (
            <Card>
              <CardHeader title="Deliveries" />
              <ul className="space-y-2 text-sm">
                {o.receipts.map((r) => <li key={r.id} className="flex justify-between"><span>Invoice {r.invoiceNo} · {date(r.receivedAt)}</span><span className="font-medium">{r.lines.reduce((s, l) => s + l.quantity, 0)} units</span></li>)}
              </ul>
            </Card>
          )}
        </div>
      </div>
      <ReceiveDialog open={receiving} order={o} onClose={() => setReceiving(false)} />
      <ConfirmDialog open={cancel} onClose={() => setCancel(false)} title={`Cancel ${o.number}?`} tone="danger" confirmLabel="Cancel order" loading={cancelOrder.isPending} onConfirm={() => cancelOrder.mutate(undefined)} />
    </PageBody>
  );
}

export function ReceiveDialog({ open, order, onClose }: { open: boolean; order: OrderDetailData; onClose: () => void }) {
  const [invoice, setInvoice] = useState('');
  const [rows, setRows] = useState<Record<string, { quantity: string; unitCost: string }>>({});
  const [scan, setScan] = useState('');
  useEffect(() => {
    if (open) {
      setInvoice('');
      setRows(Object.fromEntries(order.lines.map((l) => [l.id, { quantity: String(Math.max(0, l.qtyOrdered - l.qtyReceived)), unitCost: dollars(l.unitCost) }])));
    }
  }, [open, order]);
  const onScan = () => {
    const line = order.lines.find((l) => l.product?.barcode === scan.trim());
    if (line) setRows((r) => ({ ...r, [line.id]: { ...r[line.id]!, quantity: String(Number(r[line.id]?.quantity ?? 0) + 1) } }));
    setScan('');
  };
  const receive = useAction(
    () => api.post<{ costChanges: string[] }>(`/office/orders/${order.id}/receive`, { invoiceNo: invoice, lines: order.lines.map((l) => ({ lineId: l.id, quantity: Number(rows[l.id]?.quantity ?? 0), unitCost: parseMoney(rows[l.id]?.unitCost ?? '') ?? l.unitCost })) }),
    { success: (r) => (r.costChanges.length ? `Goods received — ${r.costChanges.length} cost change(s) recorded` : 'Goods received and stock updated'), invalidate: [['office']], onSuccess: onClose },
  );
  return (
    <Dialog open={open} onClose={onClose} size="xl" title={`Receive ${order.number}`} description="Record what actually arrived — delivered quantities and invoice costs can differ from the order."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!invoice} loading={receive.isPending} onClick={() => receive.mutate(undefined)}>Complete receiving</Button></>}>
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Field label="Supplier invoice number" required><Input value={invoice} onChange={(e) => setInvoice(e.target.value)} /></Field>
        <Field label="Scan to count" hint="Each scan adds one to the matching line"><form onSubmit={(e) => { e.preventDefault(); onScan(); }}><Input value={scan} onChange={(e) => setScan(e.target.value)} placeholder="Scan barcode" /></form></Field>
      </div>
      <Table>
        <THead><tr><TH>Product</TH><TH align="right">Outstanding</TH><TH align="right">Received now</TH><TH align="right">Invoice unit cost</TH></tr></THead>
        <tbody>
          {order.lines.map((l) => (
            <TR key={l.id}>
              <TD className="text-ink-900">{l.product?.name}</TD>
              <TD align="right">{l.qtyOrdered - l.qtyReceived}</TD>
              <TD align="right"><Input type="number" min={0} value={rows[l.id]?.quantity ?? ''} onChange={(e) => setRows((r) => ({ ...r, [l.id]: { ...r[l.id]!, quantity: e.target.value } }))} className="ml-auto w-20 text-right" /></TD>
              <TD align="right"><Input value={rows[l.id]?.unitCost ?? ''} onChange={(e) => setRows((r) => ({ ...r, [l.id]: { ...r[l.id]!, unitCost: e.target.value } }))} className={cn('ml-auto w-24 text-right', parseMoney(rows[l.id]?.unitCost ?? '') !== l.unitCost && '[&]:ring-amber-400')} /></TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </Dialog>
  );
}
