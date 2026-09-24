'use client';

import { useQuery } from '@tanstack/react-query';
import { Info, MapPin, Pencil, PlusCircle, Store, Trash2, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageBody } from '@/components/layout/AppShell';
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, Dialog, Field, Input, Loading, PageHeader, Select, StatusBadge, Table, Tabs, TD, TH, THead, Toggle, TR } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { type HqGroup, useGroups } from '@/features/hq/shared/groups';
import { api } from '@/lib/api';
import { relative } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface StoreRow { id: string; code: string; name: string; suburb: string; state: string; status: string; online: boolean; lastSeenAt: string | null; groups: { id: string; name: string; priority: number }[]; queued: number; failed: number }

export function StoresPage() {
  const { can } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState<'stores' | 'groups'>('stores');
  const [editingStore, setEditingStore] = useState<StoreRow | 'new' | null>(null);
  const [editingGroup, setEditingGroup] = useState<HqGroup | 'new' | null>(null);
  const [removing, setRemoving] = useState<{ kind: 'store' | 'group'; id: string; name: string } | null>(null);
  const stores = useQuery({ queryKey: ['hq', 'stores'], queryFn: () => api.get<StoreRow[]>('/hq/stores') });
  const groups = useGroups();
  const connectivity = useAction(({ id, online }: { id: string; online: boolean }) => api.post(`/hq/stores/${id}/connectivity`, { online }), { success: 'Store connectivity updated', invalidate: [['hq']] });
  const remove = useAction((r: { kind: 'store' | 'group'; id: string }) => api.delete(`/hq/${r.kind === 'store' ? 'stores' : 'groups'}/${r.id}`), { success: 'Removed', invalidate: [['hq']], onSuccess: () => setRemoving(null) });
  const manage = can('hq.stores.manage');
  return (
    <PageBody wide>
      <PageHeader title="Stores & groups" subtitle="Enrol stores and organise them into groups that share configuration" actions={manage && (tab === 'stores'
        ? <Button variant="primary" icon={<PlusCircle className="size-4" />} onClick={() => setEditingStore('new')}>Enrol store</Button>
        : <Button variant="primary" icon={<PlusCircle className="size-4" />} onClick={() => setEditingGroup('new')}>New group</Button>)} />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ value: 'stores', label: 'Stores', count: stores.data?.length }, { value: 'groups', label: 'Store groups', count: groups.data?.length }]} />
      {tab === 'stores' ? (
        <Card padded={false}>
          {stores.isLoading ? <Loading /> : (
            <Table>
              <THead><tr><TH>Store</TH><TH>Groups (precedence order)</TH><TH>Agent</TH><TH>Last seen</TH><TH>Sync</TH><TH>Status</TH><TH /></tr></THead>
              <tbody>
                {stores.data?.map((s) => (
                  <TR key={s.id} onClick={() => router.push(`/hq/stores/${s.id}`)}>
                    <TD><span className="font-medium text-ink-900">{s.name}</span><span className="block text-xs text-ink-500">{s.code} · {s.suburb} {s.state}</span></TD>
                    <TD><div className="flex flex-wrap gap-1">{s.groups.map((g, i) => <Badge key={g.id} tone={i === 0 ? 'accent' : 'neutral'}>{i + 1}. {g.name}</Badge>)}</div></TD>
                    <TD>{manage ? <span onClick={(e) => e.stopPropagation()}><Toggle checked={s.online} onChange={(v) => connectivity.mutate({ id: s.id, online: v })} label={s.online ? <span className="flex items-center gap-1 text-emerald-700"><Wifi className="size-3.5" />Online</span> : <span className="flex items-center gap-1 text-amber-700"><WifiOff className="size-3.5" />Offline</span>} /></span> : s.online ? 'Online' : 'Offline'}</TD>
                    <TD className="text-ink-500">{relative(s.lastSeenAt)}</TD>
                    <TD>{s.failed ? <Badge tone="red">{s.failed} failed</Badge> : s.queued ? <Badge tone="amber">{s.queued} queued</Badge> : <Badge tone="green">Up to date</Badge>}</TD>
                    <TD><StatusBadge status={s.status} /></TD>
                    <TD align="right">{manage && <span onClick={(e) => e.stopPropagation()} className="flex justify-end gap-1"><Button size="xs" variant="ghost" onClick={() => setEditingStore(s)}><Pencil className="size-3.5" /></Button><Button size="xs" variant="ghost" onClick={() => setRemoving({ kind: 'store', id: s.id, name: s.name })}><Trash2 className="size-3.5" /></Button></span>}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      ) : (
        <>
          <Alert tone="blue" icon={<Info />} className="mb-4" title="How precedence works">
            A store can belong to several groups. When two groups supply conflicting settings, the group with the <strong>lowest priority number wins</strong>; ties go to the group created first. More specific settings (e.g. a drug-class rule) beat generic ones.
          </Alert>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {groups.data?.map((g) => (
              <Card key={g.id}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-sm font-bold text-[var(--accent)]">{g.priority}</span>
                    <div><div className="font-semibold text-ink-900">{g.name}</div><div className="text-xs text-ink-500">{g.description}</div></div>
                  </div>
                  {manage && <div className="flex gap-1"><Button size="xs" variant="ghost" onClick={() => setEditingGroup(g)}><Pencil className="size-3.5" /></Button><Button size="xs" variant="ghost" onClick={() => setRemoving({ kind: 'group', id: g.id, name: g.name })}><Trash2 className="size-3.5" /></Button></div>}
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">{g.members.map((m) => <Badge key={m.id}><MapPin className="size-3" />{m.code}</Badge>)}</div>
                {g.rankingBasis && <div className="mt-3 text-xs text-ink-500">Drug ranking: {g.rankingBasis.replace(/_/g, ' ').toLowerCase()}</div>}
              </Card>
            ))}
          </div>
        </>
      )}
      <StoreDialog store={editingStore} groups={groups.data ?? []} onClose={() => setEditingStore(null)} />
      <GroupDialog group={editingGroup} stores={stores.data ?? []} onClose={() => setEditingGroup(null)} />
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} tone="danger" title={`Remove ${removing?.name}?`} confirmLabel="Remove" loading={remove.isPending}
        description={removing?.kind === 'store' ? 'Stores with trading or dispensing history cannot be removed — suspend them instead.' : 'Stores keep their other group memberships.'}
        onConfirm={() => removing && remove.mutate(removing)} />
    </PageBody>
  );
}

export function StoreDialog({ store, groups, onClose }: { store: StoreRow | 'new' | null; groups: { id: string; name: string }[]; onClose: () => void }) {
  const [f, setF] = useState({ code: '', name: '', suburb: '', state: 'NSW', status: 'ACTIVE', groupIds: [] as string[] });
  useEffect(() => {
    if (store === 'new') setF({ code: '', name: '', suburb: '', state: 'NSW', status: 'ACTIVE', groupIds: [] });
    else if (store) setF({ code: store.code, name: store.name, suburb: store.suburb, state: store.state, status: store.status, groupIds: store.groups.map((g) => g.id) });
  }, [store]);
  const save = useAction(() => (store === 'new' ? api.post('/hq/stores', f) : api.patch(`/hq/stores/${(store as StoreRow).id}`, { name: f.name, suburb: f.suburb, state: f.state, status: f.status, groupIds: f.groupIds })), { success: 'Store saved', invalidate: [['hq']], onSuccess: onClose });
  return (
    <Dialog open={!!store} onClose={onClose} title={store === 'new' ? 'Enrol store' : 'Edit store'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.code || !f.name} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Store code" required><Input value={f.code} disabled={store !== 'new'} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Suburb"><Input value={f.suburb} onChange={(e) => setF({ ...f, suburb: e.target.value })} /></Field>
        <Field label="State"><Select value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}>{['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
        {store !== 'new' && <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></Select></Field>}
      </div>
      <div className="mt-4 text-[13px] font-medium text-ink-700">Groups</div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">{groups.map((g) => <Checkbox key={g.id} label={g.name} checked={f.groupIds.includes(g.id)} onChange={(v) => setF({ ...f, groupIds: v ? [...f.groupIds, g.id] : f.groupIds.filter((x) => x !== g.id) })} />)}</div>
    </Dialog>
  );
}

export function GroupDialog({ group, stores, onClose }: { group: { id: string; name: string; description: string | null; priority: number; members: { id: string }[] } | 'new' | null; stores: StoreRow[]; onClose: () => void }) {
  const [f, setF] = useState({ name: '', description: '', priority: '50', storeIds: [] as string[] });
  useEffect(() => {
    if (group === 'new') setF({ name: '', description: '', priority: '50', storeIds: [] });
    else if (group) setF({ name: group.name, description: group.description ?? '', priority: String(group.priority), storeIds: group.members.map((m) => m.id) });
  }, [group]);
  const body = { name: f.name, description: f.description, priority: Number(f.priority), storeIds: f.storeIds };
  const save = useAction(() => (group === 'new' ? api.post('/hq/groups', body) : api.patch(`/hq/groups/${(group as { id: string }).id}`, body)), { success: 'Group saved', invalidate: [['hq']], onSuccess: onClose });
  return (
    <Dialog open={!!group} onClose={onClose} title={group === 'new' ? 'New store group' : 'Edit store group'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={f.name.length < 2} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Priority" hint="Lower wins"><Input type="number" min={1} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} /></Field>
        <Field label="Description" className="sm:col-span-2"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
      <div className="mt-4 text-[13px] font-medium text-ink-700">Member stores</div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">{stores.map((s) => <Checkbox key={s.id} label={`${s.code} · ${s.name}`} checked={f.storeIds.includes(s.id)} onChange={(v) => setF({ ...f, storeIds: v ? [...f.storeIds, s.id] : f.storeIds.filter((x) => x !== s.id) })} />)}</div>
    </Dialog>
  );
}
