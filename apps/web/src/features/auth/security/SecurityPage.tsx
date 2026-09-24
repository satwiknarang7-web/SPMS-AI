'use client';

import { useQuery } from '@tanstack/react-query';
import { KeyRound, LogOut, Monitor, ShieldCheck } from 'lucide-react';
import { PageBody } from '@/components/layout/AppShell';
import { Alert, Badge, Button, Card, EmptyState, Loading, PageHeader, Table, TD, TH, THead, TR } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime, relative } from '@/lib/format';
import { useAction } from '@/lib/hooks';

interface SessionRow { id: string; userAgent: string | null; ip: string | null; createdAt: string; lastUsedAt: string; expiresAt: string; current: boolean }

/** Describe a user agent in a few words, e.g. "Chrome on Windows". */
function device(ua: string | null) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /node|undici|curl/i.test(ua) ? 'API client' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export function SecurityPage() {
  const { data, isLoading } = useQuery({ queryKey: ['auth', 'sessions'], queryFn: () => api.get<SessionRow[]>('/auth/sessions') });
  const revoke = useAction((id: string) => api.delete(`/auth/sessions/${id}`), { success: 'Device signed out', invalidate: [['auth', 'sessions']] });
  const others = useAction(() => api.post<{ revoked: number }>('/auth/logout-others'), { success: (r) => `Signed out ${r.revoked} other device(s)`, invalidate: [['auth', 'sessions']] });
  const otherCount = data?.filter((s) => !s.current).length ?? 0;
  return (
    <PageBody>
      <PageHeader
        title="My sessions"
        subtitle="Devices currently signed in to your Segue account"
        actions={otherCount > 0 && <Button icon={<LogOut className="size-4" />} loading={others.isPending} onClick={() => others.mutate(undefined)}>Sign out {otherCount} other device{otherCount === 1 ? '' : 's'}</Button>}
      />
      <Alert tone="blue" icon={<ShieldCheck />} className="mb-5" title="How your session is protected">
        Access tokens last 15 minutes and are renewed automatically with a single-use refresh token. If a refresh token is ever reused — a sign it was copied — that session is ended immediately. Sessions end after at most 7 days.
      </Alert>
      <Card padded={false}>
        {isLoading ? <Loading /> : !data?.length ? <EmptyState icon={<KeyRound />} title="No active sessions" /> : (
          <Table>
            <THead><tr><TH>Device</TH><TH>IP address</TH><TH>Signed in</TH><TH>Last active</TH><TH>Expires</TH><TH /></tr></THead>
            <tbody>
              {data.map((s) => (
                <TR key={s.id}>
                  <TD><span className="flex items-center gap-2 font-medium text-ink-900"><Monitor className="size-4 text-ink-400" />{device(s.userAgent)}{s.current && <Badge tone="green">This device</Badge>}</span></TD>
                  <TD mono>{s.ip ?? '—'}</TD>
                  <TD className="text-ink-500">{dateTime(s.createdAt)}</TD>
                  <TD className="text-ink-500">{relative(s.lastUsedAt)}</TD>
                  <TD className="text-ink-500">{dateTime(s.expiresAt)}</TD>
                  <TD align="right">{!s.current && <Button size="xs" variant="ghost" loading={revoke.isPending} onClick={() => revoke.mutate(s.id)}>Sign out</Button>}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </PageBody>
  );
}
