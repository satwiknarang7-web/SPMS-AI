import type { Metadata } from 'next';
import { VendorConsole } from '@/features/admin/vendor/VendorConsole';

export const metadata: Metadata = { title: 'Licensing console' };

export default function Page() {
  return <VendorConsole />;
}
