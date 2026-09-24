import type { Metadata } from 'next';
import { DispensePricing } from '@/features/hq/dispense-pricing/DispensePricing';

export const metadata: Metadata = { title: 'Dispense pricing' };

export default function Page() {
  return <DispensePricing />;
}
