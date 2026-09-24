'use client';

import { Redirect } from '@/features/auth/guards';
import { useSession } from '@/features/auth/session';
import { OfficeDashboard } from './OfficeDashboard';

/** Office landing page: the dashboard for managers, the product list for everyone else. */
export function OfficeHome() {
  const { canAny } = useSession();
  return canAny('office.reports.read') ? <OfficeDashboard /> : <Redirect to="/office/products" />;
}
