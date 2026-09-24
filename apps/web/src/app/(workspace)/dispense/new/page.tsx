import type { Metadata } from 'next';
import { NewScript } from '@/features/dispense/new-script/NewScript';

export const metadata: Metadata = { title: 'New script' };

export default function Page() {
  return <NewScript />;
}
