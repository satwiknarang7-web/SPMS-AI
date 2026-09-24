import type { Metadata } from 'next';
import { Orders } from '@/features/office/purchasing/Orders';

export const metadata: Metadata = { title: 'Purchasing' };

export default function Page() {
  return <Orders />;
}
