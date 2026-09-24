import type { Metadata } from 'next';
import { PriceFileDetail } from '@/features/hq/price-files/PriceFileDetail';

export const metadata: Metadata = { title: 'Price file' };

export default function Page() {
  return <PriceFileDetail />;
}
