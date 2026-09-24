import type { Metadata } from 'next';
import { Promotions } from '@/features/hq/promotions/Promotions';

export const metadata: Metadata = { title: 'Promotions' };

export default function Page() {
  return <Promotions />;
}
