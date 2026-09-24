import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginPage } from '@/features/auth/login/LoginPage';

export const metadata: Metadata = { title: 'Sign in' };

export default function Page() {
  return (
    <Suspense>
      <LoginPage />
    </Suspense>
  );
}
