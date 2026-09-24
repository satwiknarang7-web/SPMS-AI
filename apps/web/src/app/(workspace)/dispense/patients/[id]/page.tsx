import type { Metadata } from 'next';
import { PatientDetail } from '@/features/dispense/patients/PatientDetail';

export const metadata: Metadata = { title: 'Patient' };

export default function Page() {
  return <PatientDetail />;
}
