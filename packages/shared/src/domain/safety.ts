/**
 * Clinical safety layer. Runs before a script can be finally checked.
 *
 * In production the interaction/allergy knowledge base comes from a licensed clinical
 * drug-information service via an integration adapter; this module is the rules engine
 * that evaluates whatever knowledge base it is given. Alerts inform the pharmacist —
 * they never remove professional discretion: HIGH alerts require an acknowledged
 * intervention, not a hard stop.
 */
export type AlertSeverity = 'HIGH' | 'MODERATE' | 'LOW';
export type AlertType = 'ALLERGY' | 'INTERACTION' | 'DUPLICATE_THERAPY' | 'CONTROLLED_DRUG' | 'PATIENT_ALERT' | 'REPEAT_INTERVAL';

export interface SafetyAlert {
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  detail: string;
}

export interface SafetyDrug {
  name: string;
  ingredient: string;
  drugClass: string | null;
  schedule: string | null;
}

export interface PatientAllergy {
  substance: string;
  reaction?: string | null;
  severity?: string | null;
}

export interface InteractionRule {
  ingredientA: string;
  ingredientB: string;
  severity: AlertSeverity;
  description: string;
}

export interface CurrentMedication {
  name: string;
  ingredient: string;
  drugClass: string | null;
  lastDispensedAt: Date | string;
}

/** Another medicine being prepared for the same patient right now (e.g. an item on the same intake). */
export interface ConcurrentMedication {
  name: string;
  ingredient: string;
  drugClass: string | null;
}

export interface SafetyInput {
  drug: SafetyDrug;
  allergies: readonly PatientAllergy[];
  currentMedications: readonly CurrentMedication[];
  /** Undispensed items prepared alongside this one — checked for interactions and duplication too. */
  concurrentMedications?: readonly ConcurrentMedication[];
  interactions: readonly InteractionRule[];
  patientAlerts?: readonly string[];
  /** When this script's previous supply was dispensed, for early-repeat detection. */
  previousSupplyAt?: Date | string | null;
  minRepeatIntervalDays?: number;
  now?: Date;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

export function runSafetyChecks(input: SafetyInput): SafetyAlert[] {
  const alerts: SafetyAlert[] = [];
  const { drug } = input;
  const ingredient = norm(drug.ingredient);
  const drugClass = norm(drug.drugClass);

  for (const allergy of input.allergies) {
    const substance = norm(allergy.substance);
    if (!substance) continue;
    if (substance === ingredient || (drugClass && substance === drugClass)) {
      alerts.push({
        type: 'ALLERGY',
        severity: 'HIGH',
        title: `Allergy: ${allergy.substance}`,
        detail: `Patient has a recorded ${allergy.severity ? norm(allergy.severity) + ' ' : ''}allergy to ${allergy.substance}${
          allergy.reaction ? ` (${allergy.reaction})` : ''
        }. ${drug.name} ${substance === ingredient ? 'contains' : 'belongs to the class'} ${allergy.substance}.`,
      });
    }
  }

  const seenInteractions = new Set<string>();
  const seenDuplicates = new Set<string>();
  const compare = (med: ConcurrentMedication, concurrent: boolean) => {
    const medIngredient = norm(med.ingredient);
    const suffix = concurrent ? ' (on this intake)' : '';
    for (const rule of input.interactions) {
      const a = norm(rule.ingredientA);
      const b = norm(rule.ingredientB);
      const hit = (a === ingredient && b === medIngredient) || (b === ingredient && a === medIngredient);
      const key = [a, b].sort().join('|');
      if (hit && !seenInteractions.has(key)) {
        seenInteractions.add(key);
        alerts.push({
          type: 'INTERACTION',
          severity: rule.severity,
          title: `Interaction with ${med.name}${suffix}`,
          detail: rule.description,
        });
      }
    }
    if (seenDuplicates.has(medIngredient)) return;
    if (medIngredient === ingredient) {
      seenDuplicates.add(medIngredient);
      alerts.push({
        type: 'DUPLICATE_THERAPY',
        severity: 'MODERATE',
        title: `Duplicate therapy: ${med.name}${suffix}`,
        detail: concurrent
          ? `${med.name} is also being dispensed on this intake (same active ingredient).`
          : `Patient is already taking ${med.name} (same active ingredient).`,
      });
    } else if (drugClass && norm(med.drugClass) === drugClass) {
      seenDuplicates.add(medIngredient);
      alerts.push({
        type: 'DUPLICATE_THERAPY',
        severity: 'LOW',
        title: `Same therapeutic class: ${med.name}${suffix}`,
        detail: `${med.name} is also in the ${drug.drugClass} class. Confirm this is intended.`,
      });
    }
  };
  for (const med of input.currentMedications) compare(med, false);
  for (const med of input.concurrentMedications ?? []) compare(med, true);

  if (drug.schedule === 'S8') {
    alerts.push({
      type: 'CONTROLLED_DRUG',
      severity: 'MODERATE',
      title: 'Schedule 8 controlled drug',
      detail: 'Record the supply in the drugs of dependence register and verify prescriber authority per state regulations.',
    });
  }

  for (const note of input.patientAlerts ?? []) {
    if (note.trim()) alerts.push({ type: 'PATIENT_ALERT', severity: 'MODERATE', title: 'Patient alert', detail: note.trim() });
  }

  if (input.previousSupplyAt && input.minRepeatIntervalDays) {
    const now = input.now ?? new Date();
    const days = (now.getTime() - new Date(input.previousSupplyAt).getTime()) / 86_400_000;
    if (days < input.minRepeatIntervalDays) {
      alerts.push({
        type: 'REPEAT_INTERVAL',
        severity: 'MODERATE',
        title: 'Early repeat supply',
        detail: `Previous supply was ${Math.floor(days)} day(s) ago; minimum interval is ${input.minRepeatIntervalDays} days.`,
      });
    }
  }

  const order: Record<AlertSeverity, number> = { HIGH: 0, MODERATE: 1, LOW: 2 };
  return alerts.sort((x, y) => order[x.severity] - order[y.severity]);
}

export const requiresIntervention = (alerts: readonly SafetyAlert[]) => alerts.some((a) => a.severity === 'HIGH');
