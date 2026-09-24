import type { Metadata } from 'next';
import { Register } from '@/features/pos/register/Register';

export const metadata: Metadata = { title: 'Register' };

export default function Page() {
  return <Register />;
}
