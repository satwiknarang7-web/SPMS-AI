'use client';

import { type ModuleKey, MODULES, type Role } from '@segue/shared';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Lock, ShieldCheck } from 'lucide-react';
import { PageBody } from '@/components/layout/AppShell';
import { ProductMark } from '@/components/layout/Brand';
import { Alert, Card, Loading, PageHeader, StatusBadge } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { date } from '@/lib/format';
import { MODULE_UI } from '@/lib/modules';

export function LicencePage() {
  const { session } = useSession();
  const { data, isLoading } = useQuery({ queryKey: ['licence'], queryFn: () => api.get<{ module: ModuleKey; status: string; expiresAt: string | null; usable: boolean }[]>('/platform/licence') });
  return (
    <PageBody>
      <PageHeader title="Licence & modules" subtitle={`${session?.tenant?.name} — modules are licensed per organisation and enforced by the Segue service`} />
      {isLoading ? <Loading /> : (
        <div className="grid gap-5 md:grid-cols-2">
          {data?.map((l) => (
            <Card key={l.module} className={cn(!l.usable && 'bg-white/70')}>
              <div className="flex items-start justify-between">
                <div className={cn(!l.usable && 'opacity-50')}><ProductMark module={MODULE_UI[l.module].label} color={MODULE_UI[l.module].color} /></div>
                <StatusBadge status={l.status} label={l.status === 'NOT_PURCHASED' ? 'Not licensed' : undefined} />
              </div>
              <p className="mt-4 text-sm text-ink-600">{MODULES[l.module].description}</p>
              <div className="mt-4 flex items-center gap-2 text-sm">
                {l.usable ? <><CheckCircle2 className="size-4 text-emerald-600" /><span className="text-ink-700">Access enabled{l.expiresAt && ` · renews ${date(l.expiresAt)}`}</span></> : <><Lock className="size-4 text-ink-400" /><span className="text-ink-500">{l.status === 'NOT_PURCHASED' ? 'Available to add to your plan' : `Licence ${l.status.toLowerCase()}${l.expiresAt ? ` on ${date(l.expiresAt)}` : ''}`}</span></>}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Alert tone="blue" icon={<ShieldCheck />} className="mt-6" title="How licensing is enforced">
        Every API request re-checks your organisation's subscriptions, so enabling or suspending a module takes effect immediately for every user and device. Role permissions are always intersected with licensed modules.
      </Alert>
    </PageBody>
  );
}
