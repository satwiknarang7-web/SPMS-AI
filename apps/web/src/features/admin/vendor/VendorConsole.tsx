'use client';

import { MODULE_KEYS, type ModuleKey, MODULES, SUBSCRIPTION_STATUSES } from '@segue/shared';
import { useQuery } from '@tanstack/react-query';
import { Building2, CheckCircle2, Clock, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageBody } from '@/components/layout/AppShell';
import { Button, Card, Checkbox, Dialog, EmptyState, Field, Input, Loading, PageHeader, Select, Table, TD, TH, THead, TR } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { api } from '@/lib/api';
import { date } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { MODULE_UI } from '@/lib/modules';

export interface Tenant { id: string; name: string; abn: string | null; createdAt: string; stores: number; users: number; subscriptions: { module: ModuleKey; status: string; expiresAt: string | null; usable: boolean }[] }

export function VendorConsole() {
  const { session } = useSession();
  const [editing, setEditing] = useState<{ tenant: Tenant; module: ModuleKey } | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['vendor', 'tenants'], queryFn: () => api.get<Tenant[]>('/vendor/tenants'), enabled: !!session?.user.isPlatformAdmin });
  if (!session?.user.isPlatformAdmin) return <PageBody><EmptyState icon={<Lock />} title="Segue staff only" description="The licensing console is for Segue platform administrators." /></PageBody>;
  return (
    <PageBody wide>
      <PageHeader eyebrow="Segue platform" title="Licensing console" subtitle="Which organisation has purchased which module. Changes apply instantly — the API checks subscriptions on every request."
        actions={<Button variant="primary" icon={<Building2 className="size-4" />} onClick={() => setOnboarding(true)}>Onboard organisation</Button>} />
      <Card padded={false}>
        {isLoading ? <Loading /> : (
          <Table>
            <THead><tr><TH>Organisation</TH><TH>Stores</TH><TH>Users</TH>{MODULE_KEYS.map((m) => <TH key={m} align="center">{MODULE_UI[m].label}</TH>)}</tr></THead>
            <tbody>
              {data?.map((t) => (
                <TR key={t.id}>
                  <TD><span className="font-medium text-ink-900">{t.name}</span><span className="block text-xs text-ink-500">ABN {t.abn ?? '—'} · since {date(t.createdAt)}</span></TD>
                  <TD>{t.stores}</TD>
                  <TD>{t.users}</TD>
                  {t.subscriptions.map((s) => (
                    <TD key={s.module} align="center">
                      <button onClick={() => setEditing({ tenant: t, module: s.module })} className="inline-flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 hover:bg-ink-50">
                        {s.usable ? <CheckCircle2 className="size-5" style={{ color: MODULE_UI[s.module].color }} /> : s.status === 'NOT_PURCHASED' ? <span className="size-5 rounded-full border-2 border-dashed border-ink-300" /> : <Clock className="size-5 text-rose-500" />}
                        <span className="text-[10px] text-ink-500">{s.status === 'NOT_PURCHASED' ? 'Not purchased' : s.status.toLowerCase()}</span>
                      </button>
                    </TD>
                  ))}
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <SubscriptionDialog value={editing} onClose={() => setEditing(null)} />
      <OnboardDialog open={onboarding} onClose={() => setOnboarding(false)} />
    </PageBody>
  );
}

export function SubscriptionDialog({ value, onClose }: { value: { tenant: Tenant; module: ModuleKey } | null; onClose: () => void }) {
  const sub = value?.tenant.subscriptions.find((s) => s.module === value.module);
  const [status, setStatus] = useState('ACTIVE');
  const [expires, setExpires] = useState('');
  useEffect(() => {
    if (value) { setStatus(sub?.status === 'NOT_PURCHASED' ? 'ACTIVE' : sub?.status ?? 'ACTIVE'); setExpires(sub?.expiresAt ? sub.expiresAt.slice(0, 10) : new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10)); }
  }, [value, sub]);
  const save = useAction(() => api.put(`/vendor/tenants/${value!.tenant.id}/subscriptions/${value!.module}`, { status, expiresAt: expires ? new Date(`${expires}T23:59:59`).toISOString() : null }), { success: 'Licence updated — effective immediately', invalidate: [['vendor']], onSuccess: onClose });
  return (
    <Dialog open={!!value} onClose={onClose} size="sm" title={value ? `${MODULES[value.module].name} — ${value.tenant.name}` : ''} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save licence</Button></>}>
      <div className="grid gap-4">
        <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)}>{SUBSCRIPTION_STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</Select></Field>
        <Field label="Expires" hint="Access stops automatically after this date"><Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

export function OnboardDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ name: '', abn: '', storeCode: '', storeName: '', suburb: '', state: 'NSW', adminName: '', adminEmail: '', adminPassword: '' });
  const [modules, setModules] = useState<ModuleKey[]>(['DISPENSE', 'POS']);
  useEffect(() => { if (open) { setF({ name: '', abn: '', storeCode: '', storeName: '', suburb: '', state: 'NSW', adminName: '', adminEmail: '', adminPassword: '' }); setModules(['DISPENSE', 'POS']); } }, [open]);
  const save = useAction(() => api.post('/vendor/tenants', { name: f.name, abn: f.abn, modules, store: { code: f.storeCode, name: f.storeName, suburb: f.suburb, state: f.state }, admin: { name: f.adminName, email: f.adminEmail, password: f.adminPassword } }), { success: 'Organisation onboarded', invalidate: [['vendor']], onSuccess: onClose });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Onboard organisation" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.name || !f.storeCode || !f.adminEmail || f.adminPassword.length < 10} onClick={() => save.mutate(undefined)}>Create</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Organisation name" required><Input value={f.name} onChange={set('name')} /></Field>
        <Field label="ABN"><Input value={f.abn} onChange={set('abn')} /></Field>
        <Field label="First store code" required><Input value={f.storeCode} onChange={set('storeCode')} /></Field>
        <Field label="Store name" required><Input value={f.storeName} onChange={set('storeName')} /></Field>
        <Field label="Suburb"><Input value={f.suburb} onChange={set('suburb')} /></Field>
        <Field label="State"><Select value={f.state} onChange={set('state')}>{['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <Field label="Admin name" required><Input value={f.adminName} onChange={set('adminName')} /></Field>
        <Field label="Admin email" required><Input value={f.adminEmail} onChange={set('adminEmail')} /></Field>
        <Field label="Admin temporary password" hint="At least 10 characters" className="sm:col-span-2"><Input type="password" value={f.adminPassword} onChange={set('adminPassword')} /></Field>
      </div>
      <div className="mt-5 text-[13px] font-medium text-ink-700">Licensed modules</div>
      <div className="mt-2 grid grid-cols-2 gap-2">{MODULE_KEYS.map((m) => <Checkbox key={m} label={MODULES[m].name} checked={modules.includes(m)} onChange={(v) => setModules((x) => (v ? [...x, m] : x.filter((y) => y !== m)))} />)}</div>
    </Dialog>
  );
}
