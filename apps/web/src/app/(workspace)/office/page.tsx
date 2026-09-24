import type { Metadata } from 'next';
import { OfficeHome } from '@/features/office/dashboard/OfficeHome';

export const metadata: Metadata = { title: 'Office' };

export default function Page() {
  return <OfficeHome />;
}
