import type { Metadata } from 'next';
import { Patients } from '@/features/dispense/patients/Patients';

export const metadata: Metadata = { title: 'Patients' };

export default function Page() {
  return <Patients />;
}
