import type { Metadata } from 'next';
import { Sales } from '@/features/pos/sales/Sales';

export const metadata: Metadata = { title: 'Sales & returns' };

export default function Page() {
  return <Sales />;
}
