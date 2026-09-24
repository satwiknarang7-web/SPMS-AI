'use client';

import type { ModuleKey, Permission } from '@segue/shared';
import { ShieldAlert } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { EmptyState, Loading } from '@/components/ui';
import { LockedModule } from '@/features/launcher/LockedModule';
import { useSession } from './session';

/**
 * Client-side session gate for the workspace. `proxy.ts` already redirects signed-out
 * visitors on the server; this handles sessions that end while the app is open.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!loading && !session) router.replace(`/login?from=${encodeURIComponent(pathname)}`);
  }, [loading, session, router, pathname]);
  if (loading || !session) return <Loading className="h-full" label="Starting Segue…" />;
  return <>{children}</>;
}

/**
 * UX-level licence gate used by each workspace layout. The API is the enforcement point —
 * this just shows a clear "not licensed" page instead of a wall of 403s.
 */
export function ModuleGate({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const { hasModule } = useSession();
  if (!hasModule(module)) return <LockedModule module={module} />;
  return <>{children}</>;
}

export function RequirePermission({ perms, children, any = true }: { perms: Permission[]; children: ReactNode; any?: boolean }) {
  const { can, canAny } = useSession();
  const ok = any ? canAny(...perms) : can(...perms);
  if (!ok) return <NoAccess />;
  return <>{children}</>;
}

export function NoAccess() {
  return (
    <EmptyState
      icon={<ShieldAlert />}
      title="Your role doesn't include this area"
      description="Access is role-based and scoped to your store. Ask your store manager or group administrator if you need it."
    />
  );
}

/** Client-side redirect (App Router has no <Navigate> component). */
export function Redirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => router.replace(to), [router, to]);
  return <Loading />;
}
