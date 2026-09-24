import type { Metadata } from 'next';
import { HqReports } from '@/features/hq/reports/HqReports';

export const metadata: Metadata = { title: 'Group reports' };

export default function Page() {
  return <HqReports />;
}
