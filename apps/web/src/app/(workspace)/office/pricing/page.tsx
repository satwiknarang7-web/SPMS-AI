import type { Metadata } from 'next';
import { PricingReview } from '@/features/office/pricing/PricingReview';

export const metadata: Metadata = { title: 'Pricing review' };

export default function Page() {
  return <PricingReview />;
}
