import type { Metadata } from 'next';
import { Stocktakes } from '@/features/office/stocktake/Stocktakes';

export const metadata: Metadata = { title: 'Stocktake' };

export default function Page() {
  return <Stocktakes />;
}
