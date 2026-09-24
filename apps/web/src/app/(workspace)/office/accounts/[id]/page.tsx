import type { Metadata } from 'next';
import { AccountDetail } from '@/features/office/accounts/AccountDetail';

export const metadata: Metadata = { title: 'Customer account' };

export default function Page() {
  return <AccountDetail />;
}
