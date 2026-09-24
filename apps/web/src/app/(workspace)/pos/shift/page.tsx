import type { Metadata } from 'next';
import { ShiftPage } from '@/features/pos/shift/ShiftPage';

export const metadata: Metadata = { title: 'Cash & balancing' };

export default function Page() {
  return <ShiftPage />;
}
