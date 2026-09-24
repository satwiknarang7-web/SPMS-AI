import type { Metadata } from 'next';
import { ScriptDetail } from '@/features/dispense/scripts/ScriptDetail';

export const metadata: Metadata = { title: 'Prescription' };

export default function Page() {
  return <ScriptDetail />;
}
