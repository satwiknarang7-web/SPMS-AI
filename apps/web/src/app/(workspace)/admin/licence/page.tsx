import type { Metadata } from 'next';
import { LicencePage } from '@/features/admin/licence/LicencePage';

export const metadata: Metadata = { title: 'Licence & modules' };

export default function Page() {
  return <LicencePage />;
}
