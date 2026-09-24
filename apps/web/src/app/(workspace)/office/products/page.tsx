import type { Metadata } from 'next';
import { Products } from '@/features/office/products/Products';

export const metadata: Metadata = { title: 'Products' };

export default function Page() {
  return <Products />;
}
