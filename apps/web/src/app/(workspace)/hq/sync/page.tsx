import type { Metadata } from 'next';
import { SyncPage } from '@/features/hq/sync/SyncPage';

export const metadata: Metadata = { title: 'Publishing & sync' };

export default function Page() {
  return <SyncPage />;
}
