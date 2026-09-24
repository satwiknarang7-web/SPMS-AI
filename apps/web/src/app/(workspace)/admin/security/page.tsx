import type { Metadata } from 'next';
import { SecurityPage } from '@/features/auth/security/SecurityPage';

export const metadata: Metadata = { title: 'My sessions' };

export default function Page() {
  return <SecurityPage />;
}
