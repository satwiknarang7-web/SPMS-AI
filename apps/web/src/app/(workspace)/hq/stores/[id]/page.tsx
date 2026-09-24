import type { Metadata } from 'next';
import { StoreConfig } from '@/features/hq/stores/StoreConfig';

export const metadata: Metadata = { title: 'Store configuration' };

export default function Page() {
  return <StoreConfig />;
}
