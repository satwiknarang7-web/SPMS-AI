import type { Metadata } from 'next';
import { HqHome } from '@/features/hq/dashboard/HqHome';

export const metadata: Metadata = { title: 'HQ' };

export default function Page() {
  return <HqHome />;
}
