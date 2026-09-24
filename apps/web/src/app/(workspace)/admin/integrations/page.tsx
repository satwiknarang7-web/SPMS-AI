import type { Metadata } from 'next';
import { IntegrationsPage } from '@/features/admin/integrations/IntegrationsPage';

export const metadata: Metadata = { title: 'Integrations' };

export default function Page() {
  return <IntegrationsPage />;
}
