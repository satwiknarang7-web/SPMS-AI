'use client';

import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, ShieldX } from 'lucide-react';
import { Alert } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guards';
import { AuditTimeline } from '@/features/shared/AuditTimeline';
import { api } from '@/lib/api';
import { dateTime, num } from '@/lib/format';

export function AuditPage() {
  const verify = useQuery({ queryKey: ['audit', 'verify'], queryFn: () => api.get<{ valid: boolean; checked: number; brokenAt: string | null; brokenAtTime: string | null }>('/platform/audit/verify') });
  return (
    <RequirePermission perms={['platform.audit.read']}>
      <div className="mx-auto max-w-7xl px-6 pt-6 lg:px-8">
        {verify.data && (verify.data.valid
          ? <Alert tone="green" icon={<ShieldCheck />} title="Audit chain verified">All {num(verify.data.checked)} events hash-chain correctly — no record has been altered or removed.</Alert>
          : <Alert tone="red" icon={<ShieldX />} title="Audit chain broken">Event {verify.data.brokenAt} ({dateTime(verify.data.brokenAtTime)}) does not match its hash. Investigate immediately.</Alert>)}
      </div>
      <AuditTimeline title="Audit log" subtitle="Tamper-evident record of every sensitive action across all modules — retained for at least seven years" />
    </RequirePermission>
  );
}
