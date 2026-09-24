'use client';

import { Redirect } from '@/features/auth/guards';
import { useSession } from '@/features/auth/session';
import { HqDashboard } from './HqDashboard';

/** HQ landing page: group dashboard for reporting roles, store list for everyone else. */
export function HqHome() {
  const { canAny } = useSession();
  return canAny('hq.reports.read') ? <HqDashboard /> : <Redirect to="/hq/stores" />;
}
