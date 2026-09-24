import type { Cents } from '../money';

/**
 * PBS patient charge rules.
 *
 * IMPORTANT: statutory amounts change (usually each 1 January). These are configuration
 * values that must be re-validated against the current PBS schedule and the National
 * Health Act 1953 before production use. They are deliberately centralised here.
 */
export const PBS_CONFIG = {
  /** General patient co-payment (from 1 Jan 2026). */
  generalCopay: 2500,
  /** Concessional patient co-payment. */
  concessionCopay: 770,
  /** Safety net thresholds (re-validate annually). */
  safetyNetGeneral: 169490,
  safetyNetConcession: 27720,
  /** Maximum discount a pharmacy may apply to a PBS co-payment. */
  maxCopayDiscount: 100,
} as const;

export const SCRIPT_TYPES = ['PBS', 'RPBS', 'PRIVATE'] as const;
export type ScriptType = (typeof SCRIPT_TYPES)[number];

export const CONCESSION_TYPES = ['GENERAL', 'CONCESSION', 'DVA'] as const;
export type ConcessionType = (typeof CONCESSION_TYPES)[number];

export interface PbsChargeInput {
  scriptType: ScriptType;
  concession: ConcessionType;
  /** Dispensed price for maximum quantity — the PBS price for the item. */
  dpmq: Cents;
  /** True once the patient's safety net threshold has been reached this calendar year. */
  safetyNetReached: boolean;
  /** Manufacturer brand premium, paid by the patient on top of the co-payment. */
  brandPremium?: Cents;
  /** Optional pharmacy co-payment discount (capped at PBS_CONFIG.maxCopayDiscount). */
  copayDiscount?: Cents;
}

export interface PbsCharge {
  patientCharge: Cents;
  governmentContribution: Cents;
  /** Portion of the patient charge that counts toward the safety net. */
  safetyNetContribution: Cents;
  copayApplied: Cents;
  brandPremium: Cents;
  underCopayment: boolean;
  basis: string;
}

/** Maximum patient co-payment for a PBS/RPBS script given concession and safety net status. */
export function maxPatientCopay(scriptType: ScriptType, concession: ConcessionType, safetyNetReached: boolean): Cents {
  const concessional = concession !== 'GENERAL' || scriptType === 'RPBS';
  if (safetyNetReached) return concessional ? 0 : PBS_CONFIG.concessionCopay;
  return concessional ? PBS_CONFIG.concessionCopay : PBS_CONFIG.generalCopay;
}

export function calculatePbsCharge(input: PbsChargeInput): PbsCharge {
  if (input.scriptType === 'PRIVATE') throw new Error('calculatePbsCharge called for a private script');
  const brandPremium = input.brandPremium ?? 0;
  const discount = Math.min(Math.max(input.copayDiscount ?? 0, 0), PBS_CONFIG.maxCopayDiscount);
  const cap = maxPatientCopay(input.scriptType, input.concession, input.safetyNetReached);

  const underCopayment = input.dpmq <= cap;
  const copay = Math.max((underCopayment ? input.dpmq : cap) - discount, 0);
  const government = Math.max(input.dpmq - copay - discount, 0);

  let basis: string;
  if (cap === 0) basis = 'Safety net — free of charge';
  else if (underCopayment) basis = 'Under co-payment — patient pays full PBS price';
  else if (input.safetyNetReached) basis = 'Safety net — concessional co-payment';
  else basis = input.concession === 'GENERAL' && input.scriptType !== 'RPBS' ? 'General co-payment' : 'Concessional co-payment';

  return {
    patientCharge: copay + brandPremium,
    governmentContribution: underCopayment ? 0 : government,
    safetyNetContribution: copay,
    copayApplied: copay,
    brandPremium,
    underCopayment,
    basis,
  };
}

export function safetyNetThreshold(concession: ConcessionType): Cents {
  return concession === 'GENERAL' ? PBS_CONFIG.safetyNetGeneral : PBS_CONFIG.safetyNetConcession;
}
