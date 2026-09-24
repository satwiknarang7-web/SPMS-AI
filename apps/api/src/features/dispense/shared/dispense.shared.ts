import { prisma } from '../../../core/db';

/** Declarations shared by more than one dispense feature. */

export async function hydrateTokens(tokens: { token: string; patientId: string; prescriberId: string; drugId: string; scriptType: string; directions: string; quantity: number; repeats: number; prescribedDate: Date }[]) {
  const [patients, prescribers, drugs] = await Promise.all([
    prisma.patient.findMany({ where: { id: { in: tokens.map((t) => t.patientId) } }, select: { id: true, firstName: true, lastName: true, dob: true } }),
    prisma.prescriber.findMany({ where: { id: { in: tokens.map((t) => t.prescriberId) } }, select: { id: true, name: true, prescriberNo: true } }),
    prisma.drug.findMany({ where: { id: { in: tokens.map((t) => t.drugId) } } }),
  ]);
  return tokens.map((t) => ({
    ...t,
    patient: patients.find((p) => p.id === t.patientId) ?? null,
    prescriber: prescribers.find((p) => p.id === t.prescriberId) ?? null,
    drug: drugs.find((d) => d.id === t.drugId) ?? null,
  }));
}

export function pickChanged(obj: Record<string, unknown>, changes: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(changes).map((k) => [k, obj[k]]));
}
