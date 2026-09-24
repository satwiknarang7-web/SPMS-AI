import type { Metadata } from 'next';
import { Suppliers } from '@/features/office/suppliers/Suppliers';

export const metadata: Metadata = { title: 'Suppliers' };

export default function Page() {
  return <Suppliers />;
}
