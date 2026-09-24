import type { Metadata } from 'next';
import { Accounts } from '@/features/office/accounts/Accounts';

export const metadata: Metadata = { title: 'Customer accounts' };

export default function Page() {
  return <Accounts />;
}
