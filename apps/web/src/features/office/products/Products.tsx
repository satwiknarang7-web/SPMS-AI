'use client';

import { useQuery } from '@tanstack/react-query';
import { Package, PlusCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageBody } from '@/components/layout/AppShell';
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, Field, Input, Loading, PageHeader, SearchInput, Select, Table, TD, TH, THead, TR } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { useCategories } from '@/features/shared/catalogue';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { money, parseMoney, pct } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface ProductRow {
  id: string; sku: string; barcode: string | null; name: string; brand: string | null; category: string; department: string; isActive: boolean; gstFree: boolean; hotkeyColor: string | null; drugId: string | null;
  retailPrice: number; costPrice: number; masterRetailPrice: number; marginPct: number; onHand: number; reorderPoint: number; reorderQty: number; primarySupplier: { id: string; name: string } | null;
}

export function Products() {
  const router = useRouter();
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [department, setDepartment] = useState('FRONT_SHOP');
  const [creating, setCreating] = useState(false);
  const cats = useCategories();
  const { data, isLoading } = useQuery({ queryKey: ['office', 'products', q, category, department], queryFn: () => api.get<ProductRow[]>('/office/products', { q, category, department }) });
  return (
    <PageBody wide>
      <PageHeader title="Products" subtitle="One catalogue shared by Dispense, POS and Office" actions={can('office.products.write') && <Button variant="primary" icon={<PlusCircle className="size-4" />} onClick={() => setCreating(true)}>New product</Button>} />
      <div className="mb-4 flex flex-wrap gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Name, brand, SKU or barcode" className="w-80" shortcut="/" />
        <Select value={department} onChange={(e) => setDepartment(e.target.value)} className="w-44"><option value="">All departments</option><option value="FRONT_SHOP">Front shop</option><option value="DISPENSARY">Dispensary</option></Select>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-56"><option value="">All categories</option>{cats.data?.map((c) => <option key={c.category} value={c.category}>{c.category} ({c.count})</option>)}</Select>
      </div>
      <Card padded={false}>
        {isLoading ? <Loading /> : !data?.length ? <EmptyState icon={<Package />} title="No products match" /> : (
          <Table>
            <THead><tr><TH>Product</TH><TH>SKU / barcode</TH><TH>Category</TH><TH>Supplier</TH><TH align="right">Cost</TH><TH align="right">Sell</TH><TH align="right">Margin</TH><TH align="right">On hand</TH></tr></THead>
            <tbody>
              {data.map((p) => (
                <TR key={p.id} onClick={() => router.push(`/office/products/${p.id}`)}>
                  <TD>
                    <div className="flex items-center gap-2">
                      {p.hotkeyColor && <span className="size-2.5 rounded-full" style={{ background: p.hotkeyColor }} title="POS hot key" />}
                      <span className="font-medium text-ink-900">{p.name}</span>
                      {p.gstFree && <Badge>GST-free</Badge>}
                    </div>
                  </TD>
                  <TD mono>{p.sku}<span className="block text-ink-400">{p.barcode}</span></TD>
                  <TD className="text-ink-600">{p.category}</TD>
                  <TD className="text-ink-600">{p.primarySupplier?.name ?? '—'}</TD>
                  <TD align="right">{money(p.costPrice)}</TD>
                  <TD align="right" className="font-medium text-ink-900">{money(p.retailPrice)}{p.retailPrice !== p.masterRetailPrice && <span className="block text-[10px] text-amber-700">HQ {money(p.masterRetailPrice)}</span>}</TD>
                  <TD align="right" className={cn(p.marginPct < 20 && 'text-amber-700')}>{pct(p.marginPct)}</TD>
                  <TD align="right" className={cn('font-semibold', p.onHand <= 0 ? 'text-rose-600' : p.onHand <= p.reorderPoint ? 'text-amber-700' : 'text-ink-900')}>{p.onHand}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <ProductFormDialog open={creating} onClose={() => setCreating(false)} />
    </PageBody>
  );
}

export function ProductFormDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const cats = useCategories();
  const suppliers = useQuery({ queryKey: ['office', 'suppliers'], queryFn: () => api.get<{ id: string; name: string }[]>('/office/suppliers'), enabled: open });
  const blank = { sku: '', barcode: '', name: '', brand: '', category: '', department: 'FRONT_SHOP', cost: '', retail: '', gstFree: false, reorderPoint: '4', reorderQty: '12', primarySupplierId: '', supplierCode: '' };
  const [f, setF] = useState(blank);
  useEffect(() => { if (open) setF(blank); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const cost = parseMoney(f.cost);
  const retail = parseMoney(f.retail);
  const save = useAction(
    () => api.post<{ id: string }>('/office/products', { ...f, costPrice: cost, retailPrice: retail, reorderPoint: Number(f.reorderPoint), reorderQty: Number(f.reorderQty), primarySupplierId: f.primarySupplierId || null }),
    { success: 'Product created', invalidate: [['office', 'products']], onSuccess: (p) => { onClose(); router.push(`/office/products/${p.id}`); } },
  );
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Dialog open={open} onClose={onClose} size="lg" title="New product" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.name || !f.sku || !f.category || cost == null || !retail} onClick={() => save.mutate(undefined)}>Create product</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2"><Input value={f.name} onChange={set('name')} /></Field>
        <Field label="SKU" required><Input value={f.sku} onChange={set('sku')} /></Field>
        <Field label="Barcode (EAN)"><Input value={f.barcode} onChange={set('barcode')} inputMode="numeric" /></Field>
        <Field label="Brand"><Input value={f.brand} onChange={set('brand')} /></Field>
        <Field label="Category" required>
          <Input value={f.category} onChange={set('category')} list="cat-list" />
          <datalist id="cat-list">{cats.data?.map((c) => <option key={c.category} value={c.category} />)}</datalist>
        </Field>
        <Field label="Cost price (ex supplier)" required><Input value={f.cost} onChange={set('cost')} inputMode="decimal" /></Field>
        <Field label="Selling price (inc GST)" required hint={cost != null && retail ? `Margin ${pct(((retail - cost) / retail) * 100)}` : 'Zero prices are not allowed'}><Input value={f.retail} onChange={set('retail')} inputMode="decimal" /></Field>
        <Field label="Primary supplier">
          <Select value={f.primarySupplierId} onChange={set('primarySupplierId')}><option value="">None</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        </Field>
        <Field label="Supplier product code"><Input value={f.supplierCode} onChange={set('supplierCode')} /></Field>
        <Field label="Reorder point"><Input type="number" value={f.reorderPoint} onChange={set('reorderPoint')} /></Field>
        <Field label="Reorder quantity"><Input type="number" value={f.reorderQty} onChange={set('reorderQty')} /></Field>
        <div className="sm:col-span-2"><Checkbox label="GST-free item" checked={f.gstFree} onChange={(v) => setF((x) => ({ ...x, gstFree: v }))} /></div>
      </div>
    </Dialog>
  );
}
