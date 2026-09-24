import { Suspense, type ReactNode } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Loading } from '@/components/ui';
import { RequireAuth } from '@/features/auth/guards';

/** Every signed-in page shares the shell: sidebar, module switcher, store switcher. */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>
        <Suspense fallback={<Loading />}>{children}</Suspense>
      </AppShell>
    </RequireAuth>
  );
}
