import type { Metadata } from 'next';
import { Inventory } from '@/features/office/inventory/Inventory';

export const metadata: Metadata = { title: 'Inventory' };

export default function Page() {
  return <Inventory />;
}
