import type { Metadata } from 'next';
import { DispenseReports } from '@/features/dispense/reports/DispenseReports';

export const metadata: Metadata = { title: 'Dispensing reports' };

export default function Page() {
  return <DispenseReports />;
}
