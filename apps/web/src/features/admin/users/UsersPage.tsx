'use client';

import { Badge, Button, Card, Checkbox, Dialog, Field, Input, Loading, PageHeader, Select, Table, TD, TH, THead, TR } from '@/components/ui';
import { KeyRound, PlusCircle, UserPlus } from 'lucide-react';
import { PageBody } from '@/components/layout/AppShell';
import { RequirePermission } from '@/features/auth/guards';
import { api } from '@/lib/api';
import { relative } from '@/lib/format';
import { type Role, ROLE_LABELS, ROLES } from '@segue/shared';
import { useAction } from '@/lib/hooks';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

export function UsersPage() {
  return <RequirePermission perms={['platform.users.manage']}><Users /></RequirePermission>;
}

interface UserRow { id: string; name: string; email: string; isActive: boolean; lastLoginAt: string | null; roles: { role: Role; storeId: string | null }[] }

function Users() {
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<UserRow[]>('/platform/users') });
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api.get<{ id: string; code: string; name: string }[]>('/platform/stores') });
  const storeName = (id: string | null) => (id ? stores.data?.find((s) => s.id === id)?.code ?? 'store' : 'All stores');
  return (
    <PageBody>
      <PageHeader title="Users & roles" subtitle="Least-privilege, store-scoped access. Clinical roles are separate from retail and admin roles." actions={<Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setEditing('new')}>Add user</Button>} />
      <Card padded={false}>
        {users.isLoading ? <Loading /> : (
          <Table>
            <THead><tr><TH>User</TH><TH>Roles</TH><TH>Last sign-in</TH><TH>Status</TH></tr></THead>
            <tbody>
              {users.data?.map((u) => (
                <TR key={u.id} onClick={() => setEditing(u)}>
                  <TD><span className="font-medium text-ink-900">{u.name}</span><span className="block text-xs text-ink-500">{u.email}</span></TD>
                  <TD><div className="flex flex-wrap gap-1">{u.roles.map((r, i) => <Badge key={i} tone={r.role === 'PHARMACIST' ? 'blue' : r.role.includes('ADMIN') || r.role.includes('MANAGER') ? 'violet' : 'neutral'}>{ROLE_LABELS[r.role]} · {storeName(r.storeId)}</Badge>)}</div></TD>
                  <TD className="text-ink-500">{relative(u.lastLoginAt)}</TD>
                  <TD>{u.isActive ? <Badge tone="green" dot>Active</Badge> : <Badge tone="red" dot>Deactivated</Badge>}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <UserDialog user={editing} stores={stores.data ?? []} onClose={() => setEditing(null)} />
    </PageBody>
  );
}

function UserDialog({ user, stores, onClose }: { user: UserRow | 'new' | null; stores: { id: string; code: string; name: string }[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [active, setActive] = useState(true);
  const [roles, setRoles] = useState<{ role: Role; storeId: string | null }[]>([]);
  useEffect(() => {
    if (user === 'new') { setName(''); setEmail(''); setPassword(''); setActive(true); setRoles([{ role: 'PHARMACY_ASSISTANT', storeId: stores[0]?.id ?? null }]); }
    else if (user) { setName(user.name); setEmail(user.email); setPassword(''); setActive(user.isActive); setRoles(user.roles); }
  }, [user, stores]);
  const save = useAction(() => (user === 'new' ? api.post('/platform/users', { name, email, password, roles }) : api.patch(`/platform/users/${(user as UserRow).id}`, { name, isActive: active, roles, ...(password ? { password } : {}) })), { success: 'User saved', invalidate: [['users']], onSuccess: onClose });
  return (
    <Dialog open={!!user} onClose={onClose} size="lg" title={user === 'new' ? 'Add user' : 'Edit user'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!name || !roles.length || (user === 'new' && (password.length < 10 || !email))} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Email" required><Input value={email} disabled={user !== 'new'} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label={user === 'new' ? 'Temporary password' : 'Reset password'} hint="At least 10 characters"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} icon={<KeyRound />} /></Field>
        {user !== 'new' && <div className="pt-7"><Checkbox label="Account active" checked={active} onChange={setActive} /></div>}
      </div>
      <div className="mt-5 mb-2 flex items-center justify-between"><span className="text-[13px] font-medium text-ink-700">Role grants</span><Button size="xs" variant="ghost" icon={<PlusCircle className="size-3.5" />} onClick={() => setRoles((r) => [...r, { role: 'PHARMACY_ASSISTANT', storeId: stores[0]?.id ?? null }])}>Add role</Button></div>
      <div className="space-y-2">
        {roles.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <Select value={r.role} onChange={(e) => setRoles((rs) => rs.map((x, j) => (j === i ? { ...x, role: e.target.value as Role } : x)))}>{ROLES.map((x) => <option key={x} value={x}>{ROLE_LABELS[x]}</option>)}</Select>
            <Select value={r.storeId ?? ''} onChange={(e) => setRoles((rs) => rs.map((x, j) => (j === i ? { ...x, storeId: e.target.value || null } : x)))}><option value="">All stores (tenant-wide)</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</Select>
            <Button variant="ghost" size="sm" onClick={() => setRoles((rs) => rs.filter((_, j) => j !== i))}>Remove</Button>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink-500">Store managers can grant store roles for their own store only; tenant-wide and head-office roles require a group or system administrator.</p>
    </Dialog>
  );
}
