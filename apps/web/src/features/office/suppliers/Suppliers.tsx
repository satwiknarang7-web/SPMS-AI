'use client';

import { useQuery } from '@tanstack/react-query';
import { Landmark, Pencil, PlusCircle, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageBody } from '@/components/layout/AppShell';
import { Badge, Button, Card, Checkbox, DescriptionList, Dialog, Field, Input, Loading, PageHeader } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { Orders } from '@/features/office/purchasing/Orders';
import { Supplier } from '@/features/office/shared/types';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';

export function Suppliers() {
  const { can } = useSession();
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['office', 'suppliers'], queryFn: () => api.get<Supplier[]>('/office/suppliers') });
  return (
    <PageBody>
      <PageHeader title="Suppliers" subtitle="Wholesalers and direct suppliers, electronic or manual" actions={can('office.suppliers.write') && <Button variant="primary" icon={<PlusCircle className="size-4" />} onClick={() => setEditing('new')}>Add supplier</Button>} />
      {isLoading ? <Loading /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data?.map((s) => (
            <Card key={s.id}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"><Landmark className="size-5" /></span>
                  <div><div className="font-semibold text-ink-900">{s.name}</div><div className="text-xs text-ink-500">Account {s.accountNo ?? '—'}</div></div>
                </div>
                {can('office.suppliers.write') && <Button size="xs" variant="ghost" onClick={() => setEditing(s)}><Pencil className="size-3.5" /></Button>}
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {s.electronic ? <Badge tone="green"><Wifi className="size-3" /> Electronic ordering</Badge> : <Badge><WifiOff className="size-3" /> Manual</Badge>}
                {s.terms && <Badge>{s.terms}</Badge>}
              </div>
              <DescriptionList columns={2} items={[{ label: 'Contact', value: s.contactName ?? '—' }, { label: 'Phone', value: s.phone ?? '—' }, { label: 'Products', value: s._count.products }, { label: 'Orders', value: s._count.orders }]} />
            </Card>
          ))}
        </div>
      )}
      <SupplierDialog supplier={editing} onClose={() => setEditing(null)} />
    </PageBody>
  );
}

export function SupplierDialog({ supplier, onClose }: { supplier: Supplier | 'new' | null; onClose: () => void }) {
  const [f, setF] = useState({ name: '', accountNo: '', contactName: '', email: '', phone: '', terms: '', electronic: false });
  useEffect(() => {
    if (supplier === 'new') setF({ name: '', accountNo: '', contactName: '', email: '', phone: '', terms: '', electronic: false });
    else if (supplier) setF({ name: supplier.name, accountNo: supplier.accountNo ?? '', contactName: supplier.contactName ?? '', email: supplier.email ?? '', phone: supplier.phone ?? '', terms: supplier.terms ?? '', electronic: supplier.electronic });
  }, [supplier]);
  const save = useAction(() => (supplier === 'new' ? api.post('/office/suppliers', f) : api.patch(`/office/suppliers/${(supplier as Supplier).id}`, f)), { success: 'Supplier saved', invalidate: [['office', 'suppliers']], onSuccess: onClose });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Dialog open={!!supplier} onClose={onClose} title={supplier === 'new' ? 'Add supplier' : 'Edit supplier'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={f.name.length < 2} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2" required><Input value={f.name} onChange={set('name')} /></Field>
        <Field label="Account number"><Input value={f.accountNo} onChange={set('accountNo')} /></Field>
        <Field label="Terms"><Input value={f.terms} onChange={set('terms')} placeholder="e.g. 30 days EOM" /></Field>
        <Field label="Contact"><Input value={f.contactName} onChange={set('contactName')} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Email" className="sm:col-span-2"><Input value={f.email} onChange={set('email')} /></Field>
        <div className="sm:col-span-2"><Checkbox label="Connected via electronic ordering gateway (orders and invoices exchanged electronically)" checked={f.electronic} onChange={(v) => setF((x) => ({ ...x, electronic: v }))} /></div>
      </div>
    </Dialog>
  );
}
