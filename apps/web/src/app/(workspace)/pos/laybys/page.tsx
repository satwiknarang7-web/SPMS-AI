import type { Metadata } from 'next';
import { Laybys } from '@/features/pos/laybys/Laybys';

export const metadata: Metadata = { title: 'Laybys' };

export default function Page() {
  return <Laybys />;
}
