import type { Metadata } from 'next';
import { RetailPricing } from '@/features/hq/retail-pricing/RetailPricing';

export const metadata: Metadata = { title: 'Retail pricing' };

export default function Page() {
  return <RetailPricing />;
}
