'use client';

import { useQuery } from '@tanstack/react-query';
import { Activity, PauseCircle, RefreshCw } from 'lucide-react';
import { PageBody } from '@/components/layout/AppShell';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Loading, PageHeader, StatusBadge } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { api } from '@/lib/api';
import { dateTime, num, relative } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface Integration { key: string; name: string; category: string; purpose: string; prerequisites: string; usedBy: string[]; status: 'CONNECTED' | 'NOT_CONFIGURED' | 'ON_HOLD'; fallback: string; lastRun: { status: string; message: string | null; startedAt: string; records: number } | null; mirroredItems?: number; lastSuccessAt?: string | null }

export function IntegrationsPage() {
  const { canAny } = useSession();
  const { data, isLoading } = useQuery({ queryKey: ['integrations'], queryFn: () => api.get<Integration[]>('/platform/integrations') });
  const sync = useAction(() => api.post<{ status: string; records: number; drugsUpdated: number; error?: string }>('/platform/integrations/pbs/sync'), {
    success: (r) => (r.status === 'SUCCESS' ? `PBS schedule synced — ${num(r.records)} items, ${r.drugsUpdated} drugs refreshed` : r.status === 'SKIPPED' ? 'PBS API key not configured — using the local catalogue' : `PBS sync ${r.status.toLowerCase()}${r.error ? `: ${r.error}` : ''}`),
    invalidate: [['integrations']],
  });
  if (!canAny('platform.users.manage', 'platform.audit.read', 'hq.config.read')) return <PageBody><EmptyState title="Administrators only" /></PageBody>;
  const pbs = data?.find((i) => i.key === 'PBS');
  return (
    <PageBody>
      <PageHeader title="Integrations" subtitle="External systems connect through adapters at the platform edge — an outage in one never stops dispensing or checkout" />
      {isLoading || !data ? <Loading /> : (
        <>
          {pbs && (
            <Card className="mb-6">
              <CardHeader title={pbs.name} subtitle={pbs.purpose} icon={<Activity />} actions={<Button icon={<RefreshCw className="size-4" />} loading={sync.isPending} onClick={() => sync.mutate(undefined)}>Sync schedule now</Button>} />
              <div className="grid gap-4 sm:grid-cols-4">
                <div><div className="text-xs text-ink-500">Status</div><div className="mt-1"><StatusBadge status={pbs.status} label={pbs.status === 'NOT_CONFIGURED' ? 'Key not configured' : undefined} /></div></div>
                <div><div className="text-xs text-ink-500">Items mirrored</div><div className="mt-1 font-semibold tnum">{num(pbs.mirroredItems ?? 0)}</div></div>
                <div><div className="text-xs text-ink-500">Last successful sync</div><div className="mt-1 text-sm">{pbs.lastSuccessAt ? dateTime(pbs.lastSuccessAt) : 'Never'}</div></div>
                <div><div className="text-xs text-ink-500">Last run</div><div className="mt-1 text-sm">{pbs.lastRun ? `${pbs.lastRun.status.toLowerCase()} · ${relative(pbs.lastRun.startedAt)}` : '—'}</div></div>
              </div>
              {pbs.lastRun?.message && <p className="mt-3 text-sm text-ink-600">{pbs.lastRun.message}</p>}
              {pbs.status === 'NOT_CONFIGURED' && (
                <Alert tone="amber" className="mt-4" title="Add a PBS Data API subscription key">
                  Get a free key from the PBS Data API portal (data-api-portal.health.gov.au), set <code className="font-mono">PBS_API_KEY</code> in <code className="font-mono">apps/api/.env</code> and restart the API. Until then, dispensing uses the local drug master. The public API allows roughly one request every 20 seconds, so the full schedule syncs in the background.
                </Alert>
              )}
            </Card>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {data.filter((i) => i.key !== 'PBS').map((i) => (
              <Card key={i.key}>
                <div className="flex items-start justify-between gap-3">
                  <div><div className="font-semibold text-ink-900">{i.name}</div><div className="text-xs text-ink-500">{i.category} · used by {i.usedBy.join(', ')}</div></div>
                  <Badge tone="neutral"><PauseCircle className="size-3" /> On hold</Badge>
                </div>
                <p className="mt-3 text-sm text-ink-600">{i.purpose}</p>
                <dl className="mt-3 space-y-1 text-xs">
                  <div><dt className="inline font-semibold text-ink-600">Needs: </dt><dd className="inline text-ink-500">{i.prerequisites}</dd></div>
                  <div><dt className="inline font-semibold text-ink-600">Meanwhile: </dt><dd className="inline text-ink-500">{i.fallback}</dd></div>
                </dl>
              </Card>
            ))}
          </div>
        </>
      )}
    </PageBody>
  );
}
