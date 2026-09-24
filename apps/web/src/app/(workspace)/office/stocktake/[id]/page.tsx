import type { Metadata } from 'next';
import { StocktakeDetail } from '@/features/office/stocktake/StocktakeDetail';

export const metadata: Metadata = { title: 'Stocktake' };

export default function Page() {
  return <StocktakeDetail />;
}
