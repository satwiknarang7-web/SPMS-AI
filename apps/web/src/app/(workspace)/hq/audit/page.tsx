import type { Metadata } from 'next';
import { HqAudit } from '@/features/hq/audit/HqAudit';

export const metadata: Metadata = { title: 'Change log' };

export default function Page() {
  return <HqAudit />;
}
