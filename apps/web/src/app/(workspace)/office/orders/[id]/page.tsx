import type { Metadata } from 'next';
import { OrderDetail } from '@/features/office/purchasing/OrderDetail';

export const metadata: Metadata = { title: 'Purchase order' };

export default function Page() {
  return <OrderDetail />;
}
