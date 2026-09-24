import type { Metadata } from 'next';
import { DispenseDashboard } from '@/features/dispense/dashboard/DispenseDashboard';

export const metadata: Metadata = { title: 'Dispense' };

export default function Page() {
  return <DispenseDashboard />;
}
