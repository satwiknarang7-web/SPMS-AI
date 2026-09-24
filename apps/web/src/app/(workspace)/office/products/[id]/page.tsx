import type { Metadata } from 'next';
import { ProductDetail } from '@/features/office/products/ProductDetail';

export const metadata: Metadata = { title: 'Product' };

export default function Page() {
  return <ProductDetail />;
}
