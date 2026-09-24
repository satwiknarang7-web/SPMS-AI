import type { Metadata } from 'next';
import { Hire } from '@/features/pos/hire/Hire';

export const metadata: Metadata = { title: 'Equipment hire' };

export default function Page() {
  return <Hire />;
}
