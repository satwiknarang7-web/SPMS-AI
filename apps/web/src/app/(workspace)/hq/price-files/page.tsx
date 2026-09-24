import type { Metadata } from 'next';
import { PriceFiles } from '@/features/hq/price-files/PriceFiles';

export const metadata: Metadata = { title: 'Supplier price files' };

export default function Page() {
  return <PriceFiles />;
}
