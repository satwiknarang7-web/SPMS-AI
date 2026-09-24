'use client';

import { useQuery } from '@tanstack/react-query';
import { PlusCircle, Trash2, Truck } from 'lucide-react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageBody } from '@/components/layout/AppShell';
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, Loading, PageHeader, SearchInput, Select, StatusBadge, Table, Tabs, TD, TH, THead, TR } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import type { ProductRow } from '@/features/office/products/Products';
import { Supplier } from '@/features/office/shared/types';
import { api } from '@/lib/api';
import { date, dollars, money, parseMoney } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface OrderRow { id: string; number: string; status: string; source: string; createdAt: string; submittedAt: string | null; expectedAt: string | null; supplier: { name: string; electronic: boolean }; lineCount: number; total: number; ordered: number; received: number }

export function Orders() {
  const router = useRouter();
  const { can } = useSession();
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['office', 'orders', status], queryFn: () => api.get<OrderRow[]>('/office/orders', { status }) });
  return (
    <PageBody>
      <PageHeader title="Purchasing" subtitle="Purchase orders from draft through to goods received" actions={<>
        <Link href="/office/inventory?tab=reorder"><Button>Reorder suggestions</Button></Link>
        {can('office.purchasing.write') && <Button variant="primary" icon={<PlusCircle className="size-4" />} onClick={() => setCreating(true)}>New order</Button>}
      </>} />
      <Tabs className="mb-4" value={status} onChange={setStatus} tabs={[{ value: '', label: 'All' }, { value: 'DRAFT', label: 'Draft' }, { value: 'SUBMITTED,PARTIALLY_RECEIVED', label: 'Awaiting delivery' }, { value: 'RECEIVED', label: 'Received' }]} />
      <Card padded={false}>
        {isLoading ? <Loading /> : !data?.length ? <EmptyState icon={<Truck />} title="No purchase orders" /> : (
          <Table>
            <THead><tr><TH>Order</TH><TH>Supplier</TH><TH>Source</TH><TH>Created</TH><TH>Expected</TH><TH>Received</TH><TH>Status</TH><TH align="right">Value</TH></tr></THead>
            <tbody>
              {data.map((o) => (
                <TR key={o.id} onClick={() => router.push(`/office/orders/${o.id}`)}>
                  <TD mono>{o.number}</TD>
                  <TD className="font-medium text-ink-900">{o.supplier.name}</TD>
                  <TD><Badge>{o.source.toLowerCase()}</Badge></TD>
                  <TD className="text-ink-500">{date(o.createdAt)}</TD>
                  <TD className="text-ink-500">{date(o.expectedAt)}</TD>
                  <TD>{o.received}/{o.ordered}</TD>
                  <TD><StatusBadge status={o.status} /></TD>
                  <TD align="right" className="font-medium">{money(o.total)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <NewOrderDialog open={creating} onClose={() => setCreating(false)} />
    </PageBody>
  );
}

export function NewOrderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState('');
  const [q, setQ] = useState('');
  const [lines, setLines] = useState<{ productId: string; name: string; quantity: number; unitCost: number }[]>([]);
  useEffect(() => { if (open) { setLines([]); setSupplierId(''); } }, [open]);
  const suppliers = useQuery({ queryKey: ['office', 'suppliers'], queryFn: () => api.get<Supplier[]>('/office/suppliers'), enabled: open });
  const products = useQuery({ queryKey: ['office', 'products', q, '', ''], queryFn: () => api.get<ProductRow[]>('/office/products', { q, take: 20 }), enabled: q.length >= 2 });
  const save = useAction(() => api.post<{ id: string }>('/office/orders', { supplierId, lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitCost: l.unitCost })) }), { success: 'Draft order created', invalidate: [['office']], onSuccess: (o) => { onClose(); router.push(`/office/orders/${o.id}`); } });
  return (
    <Dialog open={open} onClose={onClose} size="xl" title="New purchase order" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!supplierId || !lines.length} loading={save.isPending} onClick={() => save.mutate(undefined)}>Create draft · {money(lines.reduce((s, l) => s + l.quantity * l.unitCost, 0))}</Button></>}>
      <div className="grid gap-6 md:grid-cols-[1fr_1.3fr]">
        <div>
          <Field label="Supplier" required><Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Select…</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Add products" className="mt-4"><SearchInput value={q} onChange={setQ} placeholder="Search products" /></Field>
          <div className="mt-1 max-h-72 overflow-y-auto rounded-lg ring-1 ring-ink-200">
            {products.data?.map((p) => (
              <button key={p.id} onClick={() => setLines((ls) => (ls.some((l) => l.productId === p.id) ? ls : [...ls, { productId: p.id, name: p.name, quantity: Math.max(p.reorderQty, 1), unitCost: p.costPrice }]))} className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-ink-50">
                <span className="truncate">{p.name}</span><span className="text-xs text-ink-500">{p.onHand} on hand</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <Table>
            <THead><tr><TH>Product</TH><TH align="right">Qty</TH><TH align="right">Unit cost</TH><TH /></tr></THead>
            <tbody>
              {lines.map((l, i) => (
                <TR key={l.productId}>
                  <TD className="text-ink-900">{l.name}</TD>
                  <TD align="right"><Input type="number" min={1} value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: Math.max(1, Number(e.target.value)) } : x)))} className="ml-auto w-20 text-right" /></TD>
                  <TD align="right"><Input defaultValue={dollars(l.unitCost)} onBlur={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitCost: parseMoney(e.target.value) ?? x.unitCost } : x)))} className="ml-auto w-24 text-right" /></TD>
                  <TD><Button size="xs" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></Button></TD>
                </TR>
              ))}
            </tbody>
          </Table>
          {!lines.length && <p className="p-4 text-sm text-ink-500">Search and click products to add them.</p>}
        </div>
      </div>
    </Dialog>
  );
}
