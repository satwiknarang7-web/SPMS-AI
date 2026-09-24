import type { SafetyAlert } from '@segue/shared';

export interface Allergy {
  substance: string;
  reaction?: string | null;
  severity?: string | null;
}

export interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  dob: string;
  gender?: string | null;
  medicareNo?: string | null;
  concessionType: 'GENERAL' | 'CONCESSION' | 'DVA';
  concessionNo?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  allergies: string;
  alerts: string;
  notes?: string | null;
  safetyNetTotal: number;
}

export interface Prescriber {
  id: string;
  name: string;
  prescriberNo: string;
  type: string;
  practice?: string | null;
}

export interface DrugItem {
  rank: number;
  reason: string;
  flag: 'PREFERRED' | 'RESTRICTED' | 'EXCLUDED' | null;
  drugId: string;
  productId: string | null;
  barcode: string | null;
  brandName: string;
  schedule: string | null;
  drugClass: string | null;
  pbsCode: string | null;
  packSize: number;
  dpmq: number | null;
  brandPremium: number;
  maxQuantity: number | null;
  maxRepeats: number | null;
  cost: number;
  onHand: number;
}

export interface DrugGroup {
  genericName: string;
  strength: string;
  form: string;
  basis: string;
  excluded: string[];
  items: DrugItem[];
}

export interface Quote {
  price: {
    patientPrice: number;
    governmentContribution: number;
    safetyNetContribution: number;
    brandPremium: number;
    basis: string;
    ruleId: string | null;
    ruleGroup: string | null;
    safetyNetReached: boolean;
    packs: number;
  };
  alerts: SafetyAlert[];
  requiresIntervention: boolean;
}

export interface ScriptRow {
  id: string;
  number: string;
  status: string;
  scriptType: string;
  source: string;
  quantity: number;
  repeatsTotal: number;
  supplyNo: number;
  patientPrice: number | null;
  updatedAt: string;
  dispensedAt: string | null;
  patient: { id: string; firstName: string; lastName: string; concessionType: string };
  prescriber: { name: string };
  drug: { brandName: string; genericName: string; strength: string; form: string; schedule: string | null };
}

export interface ErxToken {
  token: string;
  patientId: string;
  prescriberId: string;
  drugId: string;
  scriptType: 'PBS' | 'RPBS' | 'PRIVATE';
  directions: string;
  quantity: number;
  repeats: number;
  prescribedDate: string;
  patient: { id: string; firstName: string; lastName: string; dob: string } | null;
  prescriber: { id: string; name: string; prescriberNo: string } | null;
  drug: { id: string; genericName: string; brandName: string; strength: string; form: string } | null;
}

export const parseAllergies = (p: { allergies: string | Allergy[] }): Allergy[] => (typeof p.allergies === 'string' ? JSON.parse(p.allergies || '[]') : p.allergies);

export const parseAlerts = (p: { alerts: string | string[] }): string[] => (typeof p.alerts === 'string' ? JSON.parse(p.alerts || '[]') : p.alerts);

export const SCRIPT_STATUS_LABEL: Record<string, string> = {
  IN_PROGRESS: 'In progress',
  AWAITING_CHECK: 'Awaiting check',
  READY: 'Ready for collection',
  COLLECTED: 'Collected',
  DEFERRED: 'Deferred',
  CANCELLED: 'Cancelled',
};

export const CONCESSION_LABEL: Record<string, string> = { GENERAL: 'General', CONCESSION: 'Concession', DVA: 'DVA (RPBS)' };
