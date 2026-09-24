import type { ReactNode } from 'react';
import { ModuleGate } from '@/features/auth/guards';

/** Shows the upgrade page when the organisation has no OFFICE licence (the API enforces it too). */
export default function Layout({ children }: { children: ReactNode }) {
  return <ModuleGate module="OFFICE">{children}</ModuleGate>;
}
