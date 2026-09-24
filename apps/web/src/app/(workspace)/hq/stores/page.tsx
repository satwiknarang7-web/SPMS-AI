import type { Metadata } from 'next';
import { StoresPage } from '@/features/hq/stores/StoresPage';

export const metadata: Metadata = { title: 'Stores & groups' };

export default function Page() {
  return <StoresPage />;
}
