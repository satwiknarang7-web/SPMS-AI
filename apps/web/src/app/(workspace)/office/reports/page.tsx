import type { Metadata } from 'next';
import { OfficeReports } from '@/features/office/reports/OfficeReports';

export const metadata: Metadata = { title: 'Store reports' };

export default function Page() {
  return <OfficeReports />;
}
