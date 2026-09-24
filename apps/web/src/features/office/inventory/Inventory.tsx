'use client';

import { useQuery } from '@tanstack/react-query';
import { PackageCheck, PackagePlus, Truck } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUrlSearchParams } from '@/lib/navigation';
import { PageBody } from '@/components/layout/AppShell';
import { Badge, Button, Card, EmptyState, Loading, PageHeader, Select, Table, Tabs, TD, TH, THead, TR } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dateTime, money } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface Movement { id: string; quantity: number; reason: string; note: string | null; refType: string | null; createdAt: string; product: { id: string; name: string; sku: string } | null; user: string | null }

export interface ReorderGroup { supplier: { id: string; name: string; electronic: boolean } | null; items: { productId: string; name: string; sku: string; onHand: number; reorderPoint: number; onOrder: number; suggested: number; unitCost: number }[] }

export function Inventory() {
  const [params, setParams] = useUrlSearchParams();
  const tab = (params.get('tab') as 'reorder' | 'movements') ?? 'reorder';
  const [reason, setReason] = useState('');
  const router = useRouter();
  const { can } = useSession();
  const moves = useQuery({ queryKey: ['office', 'movements', reason], queryFn: () => api.get<Movement[]>('/office/inventory/movements', { reason, take: 200 }), enabled: tab === 'movements' });
  const reorder = useQuery({ queryKey: ['office', 'reorder'], queryFn: () => api.get<ReorderGroup[]>('/office/inventory/reorder'), enabled: tab === 'reorder' });
  const createPo = useAction((g: ReorderGroup) => api.post<{ id: string }>('/office/orders', { supplierId: g.supplier!.id, source: 'REORDER', lines: g.items.map((i) => ({ productId: i.productId, quantity: i.suggested, unitCost: i.unitCost })) }), {
    success: 'Draft purchase order created', invalidate: [['office']], onSuccess: (o) => router.push(`/office/orders/${o.id}`),
  });
  return (
    <PageBody wide>
      <PageHeader title="Inventory" subtitle="Real-time stock shared across Dispense, POS and Office" />
      <Tabs className="mb-4" value={tab} onChange={(v) => setParams({ tab: v })} tabs={[{ value: 'reorder', label: 'Reorder suggestions' }, { value: 'movements', label: 'Stock movements' }]} />
      {tab === 'reorder' ? (
        reorder.isLoading ? <Loading /> : !reorder.data?.length ? <Card><EmptyState icon={<PackageCheck />} title="Nothing to reorder" description="Every item is above its reorder point, or already on order." /></Card> : (
          <div className="space-y-5">
            {reorder.data.map((g) => (
              <Card key={g.supplier?.id ?? 'none'} padded={false}>
                <div className="flex items-center justify-between p-5 pb-3">
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"><Truck className="size-4" /></span>
                    <div>
                      <div className="font-semibold text-ink-900">{g.supplier?.name ?? 'No primary supplier'}</div>
                      <div className="text-xs text-ink-500">{g.items.length} items · {money(g.items.reduce((s, i) => s + i.suggested * i.unitCost, 0))} at cost {g.supplier?.electronic && '· electronic ordering'}</div>
                    </div>
                  </div>
                  {g.supplier && can('office.purchasing.write') && <Button variant="primary" icon={<PackagePlus className="size-4" />} loading={createPo.isPending} onClick={() => createPo.mutate(g)}>Create order</Button>}
                </div>
                <Table>
                  <THead><tr><TH>Product</TH><TH align="right">On hand</TH><TH align="right">Reorder at</TH><TH align="right">On order</TH><TH align="right">Suggested</TH><TH align="right">Unit cost</TH></tr></THead>
                  <tbody>
                    {g.items.map((i) => (
                      <TR key={i.productId} onClick={() => router.push(`/office/products/${i.productId}`)}>
                        <TD className="font-medium text-ink-900">{i.name}<span className="block font-mono text-xs text-ink-400">{i.sku}</span></TD>
                        <TD align="right" className={cn(i.onHand <= 0 && 'font-semibold text-rose-600')}>{i.onHand}</TD>
                        <TD align="right">{i.reorderPoint}</TD>
                        <TD align="right">{i.onOrder}</TD>
                        <TD align="right" className="font-semibold">{i.suggested}</TD>
                        <TD align="right">{money(i.unitCost)}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </Card>
            ))}
          </div>
        )
      ) : (
        <>
          <Select value={reason} onChange={(e) => setReason(e.target.value)} className="mb-4 w-56">
            <option value="">All reasons</option>
            {['RECEIPT', 'SALE', 'DISPENSE', 'ADJUSTMENT', 'STOCKTAKE', 'RETURN', 'WRITE_OFF', 'TRANSFER', 'LAYBY'].map((r) => <option key={r} value={r}>{r.replace('_', ' ').toLowerCase()}</option>)}
          </Select>
          <Card padded={false}>
            {moves.isLoading ? <Loading /> : !moves.data?.length ? <EmptyState title="No movements" /> : (
              <Table>
                <THead><tr><TH>When</TH><TH>Product</TH><TH>Reason</TH><TH>Reference</TH><TH>By</TH><TH>Note</TH><TH align="right">Qty</TH></tr></THead>
                <tbody>
                  {moves.data.map((m) => (
                    <TR key={m.id} onClick={() => m.product && router.push(`/office/products/${m.product.id}`)}>
                      <TD className="text-ink-500">{dateTime(m.createdAt)}</TD>
                      <TD className="text-ink-900">{m.product?.name}</TD>
                      <TD><Badge>{m.reason.replace('_', ' ').toLowerCase()}</Badge></TD>
                      <TD className="text-ink-500">{m.refType}</TD>
                      <TD className="text-ink-600">{m.user ?? 'System'}</TD>
                      <TD className="max-w-64 truncate text-ink-500">{m.note}</TD>
                      <TD align="right" className={cn('font-semibold', m.quantity < 0 ? 'text-rose-600' : 'text-emerald-700')}>{m.quantity > 0 ? '+' : ''}{m.quantity}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}
    </PageBody>
  );
}
