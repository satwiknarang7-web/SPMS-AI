import type { Metadata } from 'next';
import { ScriptQueue } from '@/features/dispense/scripts/ScriptQueue';

export const metadata: Metadata = { title: 'Script queue' };

export default function Page() {
  return <ScriptQueue />;
}
