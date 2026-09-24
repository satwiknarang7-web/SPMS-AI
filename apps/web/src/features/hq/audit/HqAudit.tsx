'use client';

import { AuditTimeline } from '@/features/shared/AuditTimeline';

export function HqAudit() {
  return <AuditTimeline module="HQ" title="Change log" subtitle="Immutable record of every HQ configuration change, with before and after values" />;
}
