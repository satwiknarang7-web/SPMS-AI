'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Pencil, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageBody } from '@/components/layout/AppShell';
import { Badge, Button, Card, CardHeader, Checkbox, DescriptionList, Dialog, EmptyState, Field, Input, Loading, NotFound, PageHeader, Select, Table, TD, TH, THead, TR } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { Products } from '@/features/office/products/Products';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dateTime, money, pct } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface ProductDetailData {
  id: string; sku: string; barcode: string | null; name: string; brand: string | null; category: string; department: string; isActive: boolean; gstFree: boolean; hotkeyColor: string | null;
  retailPrice: number; costPrice: number; masterRetailPrice: number; masterCostPrice: number;
  storeProduct: { onHand: number; reorderPoint: number; reorderQty: number; retailPrice: number | null } | null;
  drug: { genericName: string; strength: string; pbsCode: string | null; schedule: string | null } | null;
  suppliers: { supplier: { id: string; name: string }; cost: number; isPrimary: boolean; supplierCode: string | null }[];
  movements: { id: string; quantity: number; reason: string; note: string | null; refType: string | null; createdAt: string }[];
  prices: { id: string; storeId: string | null; oldCost: number | null; newCost: number | null; oldRetail: number | null; newRetail: number | null; source: string; effectiveAt: string }[];
}

export function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const { data: p, isLoading } = useQuery({ queryKey: ['office', 'product', id], queryFn: () => api.get<ProductDetailData>(`/office/products/${id}`) });
  if (isLoading) return <Loading />;
  if (!p) return <NotFound what="product" />;
  return (
    <PageBody>
      <PageHeader
        back={<Link href="/office/products" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800"><ArrowLeft className="size-4" /> Products</Link>}
        title={p.name}
        subtitle={<span className="font-mono">{p.sku} · {p.barcode}</span>}
        actions={<>
          {can('office.inventory.adjust') && <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => setAdjusting(true)}>Adjust stock</Button>}
          {can('office.products.write') && <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Edit</Button>}
        </>}
      />
      <div className="grid gap-4 sm:grid-cols-4">
        <Card><div className="text-xs text-ink-500">On hand</div><div className="mt-1 text-2xl font-bold tnum">{p.storeProduct?.onHand ?? 0}</div><div className="text-xs text-ink-500">reorder at {p.storeProduct?.reorderPoint ?? 0}</div></Card>
        <Card><div className="text-xs text-ink-500">Selling price</div><div className="mt-1 text-2xl font-bold tnum">{money(p.retailPrice)}</div><div className="text-xs text-ink-500">{p.storeProduct?.retailPrice != null ? `Store price · HQ master ${money(p.masterRetailPrice)}` : 'Follows HQ master price'}</div></Card>
        <Card><div className="text-xs text-ink-500">Cost</div><div className="mt-1 text-2xl font-bold tnum">{money(p.costPrice)}</div></Card>
        <Card><div className="text-xs text-ink-500">Margin</div><div className="mt-1 text-2xl font-bold tnum">{pct(p.retailPrice ? ((p.retailPrice - p.costPrice) / p.retailPrice) * 100 : 0)}</div></Card>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader title="Details" />
          <DescriptionList items={[
            { label: 'Brand', value: p.brand ?? '—' }, { label: 'Category', value: p.category }, { label: 'Department', value: p.department === 'DISPENSARY' ? 'Dispensary' : 'Front shop' },
            { label: 'GST', value: p.gstFree ? 'GST-free' : 'Taxable (10%)' }, { label: 'Status', value: p.isActive ? 'Active' : 'Inactive' },
            { label: 'Dispensing link', value: p.drug ? `${p.drug.genericName} ${p.drug.strength} · PBS ${p.drug.pbsCode ?? '—'}` : 'Not a dispensed item' },
          ]} />
          <CardHeader title="Suppliers" className="mt-6" />
          <ul className="space-y-1.5 text-sm">
            {p.suppliers.map((s) => <li key={s.supplier.id} className="flex justify-between"><span>{s.supplier.name} {s.isPrimary && <Badge tone="accent">Primary</Badge>} <span className="font-mono text-xs text-ink-400">{s.supplierCode}</span></span><span className="tnum">{money(s.cost)}</span></li>)}
          </ul>
        </Card>
        <Card padded={false}>
          <div className="p-5 pb-0"><CardHeader title="Price history" subtitle="Every change, with its source" /></div>
          <Table>
            <THead><tr><TH>When</TH><TH>Source</TH><TH align="right">Cost</TH><TH align="right">Retail</TH></tr></THead>
            <tbody>
              {p.prices.map((h) => (
                <TR key={h.id}>
                  <TD className="text-ink-500">{dateTime(h.effectiveAt)}</TD>
                  <TD><Badge tone={h.storeId ? 'neutral' : 'blue'}>{h.source.replace(/_/g, ' ').toLowerCase()}{h.storeId ? '' : ' · HQ'}</Badge></TD>
                  <TD align="right">{h.newCost != null ? <>{h.oldCost != null && <span className="text-ink-400">{money(h.oldCost)} → </span>}{money(h.newCost)}</> : '—'}</TD>
                  <TD align="right">{h.newRetail != null ? <>{h.oldRetail != null && <span className="text-ink-400">{money(h.oldRetail)} → </span>}{money(h.newRetail)}</> : '—'}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
      <Card padded={false} className="mt-6">
        <div className="p-5 pb-0"><CardHeader title="Stock movements" subtitle="Every change to stock on hand carries a reason code and an actor" /></div>
        {p.movements.length === 0 ? <EmptyState title="No movements recorded yet" /> : (
          <Table>
            <THead><tr><TH>When</TH><TH>Reason</TH><TH>Reference</TH><TH>Note</TH><TH align="right">Qty</TH></tr></THead>
            <tbody>
              {p.movements.map((m) => (
                <TR key={m.id}>
                  <TD className="text-ink-500">{dateTime(m.createdAt)}</TD>
                  <TD><Badge>{m.reason.toLowerCase().replace('_', ' ')}</Badge></TD>
                  <TD className="text-ink-500">{m.refType ?? '—'}</TD>
                  <TD className="text-ink-600">{m.note ?? ''}</TD>
                  <TD align="right" className={cn('font-semibold', m.quantity < 0 ? 'text-rose-600' : 'text-emerald-700')}>{m.quantity > 0 ? '+' : ''}{m.quantity}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <EditProductDialog open={editing} onClose={() => setEditing(false)} product={p} />
      <AdjustStockDialog open={adjusting} onClose={() => setAdjusting(false)} productId={p.id} name={p.name} />
    </PageBody>
  );
}

export function EditProductDialog({ open, onClose, product }: { open: boolean; onClose: () => void; product: ProductDetailData }) {
  const [f, setF] = useState({ name: '', brand: '', barcode: '', category: '', gstFree: false, isActive: true, hotkeyColor: '', reorderPoint: '0', reorderQty: '0' });
  useEffect(() => {
    if (open) setF({ name: product.name, brand: product.brand ?? '', barcode: product.barcode ?? '', category: product.category, gstFree: product.gstFree, isActive: product.isActive, hotkeyColor: product.hotkeyColor ?? '', reorderPoint: String(product.storeProduct?.reorderPoint ?? 0), reorderQty: String(product.storeProduct?.reorderQty ?? 0) });
  }, [open, product]);
  const save = useAction(() => api.patch(`/office/products/${product.id}`, { ...f, hotkeyColor: f.hotkeyColor || null, reorderPoint: Number(f.reorderPoint), reorderQty: Number(f.reorderQty) }), { success: 'Product updated', invalidate: [['office']], onSuccess: onClose });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Edit product" description="Prices are changed through Pricing review so every change is audited." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={set('name')} /></Field>
        <Field label="Brand"><Input value={f.brand} onChange={set('brand')} /></Field>
        <Field label="Barcode"><Input value={f.barcode} onChange={set('barcode')} /></Field>
        <Field label="Category"><Input value={f.category} onChange={set('category')} /></Field>
        <Field label="POS hot key colour" hint="Pins the item to the register's hot keys"><div className="flex gap-2"><Input type="color" value={f.hotkeyColor || '#0fa89a'} onChange={set('hotkeyColor')} className="w-14 p-1" /><Button variant="ghost" size="sm" onClick={() => setF((x) => ({ ...x, hotkeyColor: '' }))}>Unpin</Button></div></Field>
        <Field label="Reorder point (this store)"><Input type="number" value={f.reorderPoint} onChange={set('reorderPoint')} /></Field>
        <Field label="Reorder quantity (this store)"><Input type="number" value={f.reorderQty} onChange={set('reorderQty')} /></Field>
        <Checkbox label="GST-free" checked={f.gstFree} onChange={(v) => setF((x) => ({ ...x, gstFree: v }))} />
        <Checkbox label="Active" checked={f.isActive} onChange={(v) => setF((x) => ({ ...x, isActive: v }))} />
      </div>
    </Dialog>
  );
}

export function AdjustStockDialog({ open, onClose, productId, name }: { open: boolean; onClose: () => void; productId: string; name: string }) {
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('ADJUSTMENT');
  const [note, setNote] = useState('');
  useEffect(() => { if (open) { setQty(''); setNote(''); setReason('ADJUSTMENT'); } }, [open]);
  const n = Number.parseInt(qty, 10);
  const save = useAction(() => api.post('/office/inventory/adjust', { productId, quantity: reason === 'WRITE_OFF' ? -Math.abs(n) : n, reason, note }), { success: 'Stock adjusted', invalidate: [['office']], onSuccess: onClose });
  return (
    <Dialog open={open} onClose={onClose} size="sm" title="Adjust stock" description={name} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!n || note.length < 3} loading={save.isPending} onClick={() => save.mutate(undefined)}>Record adjustment</Button></>}>
      <div className="grid gap-3">
        <Field label="Reason"><Select value={reason} onChange={(e) => setReason(e.target.value)}><option value="ADJUSTMENT">Adjustment (+/−)</option><option value="WRITE_OFF">Write-off (damaged / expired)</option><option value="TRANSFER">Transfer (+ in / − out)</option></Select></Field>
        <Field label="Quantity" hint={reason === 'WRITE_OFF' ? 'Entered as a reduction' : 'Negative to reduce stock'}><Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Note" required><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Required for every adjustment" /></Field>
      </div>
    </Dialog>
  );
}
