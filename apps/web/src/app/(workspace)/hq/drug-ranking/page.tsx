import type { Metadata } from 'next';
import { DrugRanking } from '@/features/hq/drug-ranking/DrugRanking';

export const metadata: Metadata = { title: 'Drug ranking' };

export default function Page() {
  return <DrugRanking />;
}
