'use client';

import { Redirect } from '@/features/auth/guards';
import { useSession } from '@/features/auth/session';
import { Launcher } from './Launcher';

/** Workspace home: the module launcher, or the licensing console for Segue staff. */
export function Home() {
  const { session } = useSession();
  if (session?.user.isPlatformAdmin && !session.tenant) return <Redirect to="/vendor" />;
  return <Launcher />;
}
