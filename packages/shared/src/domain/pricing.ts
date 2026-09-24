import { marginPct, type Cents } from '../money';
import { calculatePbsCharge, maxPatientCopay, PBS_CONFIG, type ConcessionType, type ScriptType } from './pbs';
import { resolveSetting, type GroupRef } from './precedence';

/** Condition a dispense pricing rule applies to (HQ-DP-01). */
export const PRICING_CONDITIONS = ['PBS', 'PRIVATE', 'CONCESSION'] as const;
export type PricingCondition = (typeof PRICING_CONDITIONS)[number];

export interface DispensePricingRule {
  id: string;
  groupId: string;
  condition: PricingCondition;
  /** Optional drug class filter; a class-specific rule beats a generic one. */
  drugClass: string | null;
  /** Markup applied to cost for private scripts, in percent. */
  markupPct: number;
  /** Professional/dispensing fee added to private scripts. */
  dispensingFee: Cents;
  /** Discount applied to the PBS co-payment (max $1). */
  copayDiscount: Cents;
  /** Floor margin; private prices are lifted to at least this margin. */
  minMarginPct: number;
}

/** Default pricing when no HQ rule applies (single-store tenants without HQ). */
export const DEFAULT_PRIVATE_PRICING = { markupPct: 30, dispensingFee: 850, minMarginPct: 20 } as const;

export function conditionFor(scriptType: ScriptType, concession: ConcessionType): PricingCondition {
  if (scriptType === 'PRIVATE') return 'PRIVATE';
  return concession === 'GENERAL' && scriptType === 'PBS' ? 'PBS' : 'CONCESSION';
}

export function resolveDispenseRule(
  rules: readonly DispensePricingRule[],
  storeGroups: readonly GroupRef[],
  condition: PricingCondition,
  drugClass: string | null,
): DispensePricingRule | undefined {
  const applicable = rules.filter((r) => r.condition === condition && (r.drugClass == null || r.drugClass === drugClass));
  return resolveSetting(applicable, storeGroups, (r) => (r.drugClass ? 1 : 0));
}

export function privateScriptPrice(costCents: Cents, rule?: Pick<DispensePricingRule, 'markupPct' | 'dispensingFee' | 'minMarginPct'>): Cents {
  const r = rule ?? DEFAULT_PRIVATE_PRICING;
  const marked = Math.round(costCents * (1 + r.markupPct / 100)) + r.dispensingFee;
  // Lift to the minimum margin if the markup alone would fall short.
  const floor = r.minMarginPct >= 100 ? marked : Math.ceil(costCents / (1 - r.minMarginPct / 100));
  const price = Math.max(marked, floor);
  return Math.round(price / 5) * 5;
}

export interface ScriptPriceInput {
  scriptType: ScriptType;
  concession: ConcessionType;
  safetyNetReached: boolean;
  quantity: number;
  packSize: number;
  costPerPack: Cents;
  dpmq: Cents | null;
  brandPremium: Cents;
  rule?: DispensePricingRule;
}

export interface ScriptPrice {
  patientPrice: Cents;
  governmentContribution: Cents;
  safetyNetContribution: Cents;
  brandPremium: Cents;
  basis: string;
  ruleId: string | null;
}

export function priceScript(input: ScriptPriceInput): ScriptPrice {
  const packs = Math.max(1, Math.ceil(input.quantity / Math.max(1, input.packSize)));
  if (input.scriptType === 'PRIVATE' || input.dpmq == null) {
    const price = privateScriptPrice(input.costPerPack * packs, input.rule);
    return {
      patientPrice: price,
      governmentContribution: 0,
      safetyNetContribution: 0,
      brandPremium: 0,
      basis: input.rule ? 'Private — HQ pricing rule' : 'Private — default store pricing',
      ruleId: input.rule?.id ?? null,
    };
  }
  const charge = calculatePbsCharge({
    scriptType: input.scriptType,
    concession: input.concession,
    dpmq: input.dpmq,
    safetyNetReached: input.safetyNetReached,
    brandPremium: input.brandPremium,
    copayDiscount: input.rule?.copayDiscount ?? 0,
  });
  return {
    patientPrice: charge.patientCharge,
    governmentContribution: charge.governmentContribution,
    safetyNetContribution: charge.safetyNetContribution,
    brandPremium: charge.brandPremium,
    basis: charge.basis,
    ruleId: input.rule?.id ?? null,
  };
}

export interface RuleViolation {
  field: string;
  message: string;
}

/**
 * HQ-DP-03 — a configured rule must never allow a PBS patient charge above the
 * regulated maximum, and PBS co-payment discounts are capped.
 */
export function validateDispenseRule(rule: Omit<DispensePricingRule, 'id' | 'groupId'>): RuleViolation[] {
  const v: RuleViolation[] = [];
  if (rule.markupPct < 0 || rule.markupPct > 500) v.push({ field: 'markupPct', message: 'Markup must be between 0% and 500%.' });
  if (rule.dispensingFee < 0) v.push({ field: 'dispensingFee', message: 'Dispensing fee cannot be negative.' });
  if (rule.minMarginPct < 0 || rule.minMarginPct >= 90) v.push({ field: 'minMarginPct', message: 'Minimum margin must be between 0% and 90%.' });
  if (rule.copayDiscount < 0) v.push({ field: 'copayDiscount', message: 'Co-payment discount cannot be negative.' });
  if (rule.copayDiscount > PBS_CONFIG.maxCopayDiscount)
    v.push({ field: 'copayDiscount', message: `PBS co-payment discount cannot exceed ${PBS_CONFIG.maxCopayDiscount / 100} dollar.` });
  if (rule.condition !== 'PRIVATE' && (rule.markupPct > 0 || rule.dispensingFee > 0)) {
    // Markups on PBS items would push the patient charge above the co-payment cap.
    const cap = maxPatientCopay('PBS', rule.condition === 'PBS' ? 'GENERAL' : 'CONCESSION', false);
    v.push({
      field: 'markupPct',
      message: `PBS/concession rules cannot add markup or fees — patient charge is capped at the regulated co-payment (${(cap / 100).toFixed(2)}).`,
    });
  }
  return v;
}

/* ---------------------------- Retail pricing ---------------------------- */

export interface MarginCheck {
  level: 'OK' | 'LOW_MARGIN' | 'BELOW_COST';
  marginPct: number;
  message: string | null;
}

/** POS margin protection: warn below threshold, block (without override) below cost. */
export function checkMargin(netUnitPrice: Cents, unitCost: Cents, thresholdPct: number): MarginCheck {
  const m = marginPct(netUnitPrice, unitCost);
  if (netUnitPrice < unitCost) return { level: 'BELOW_COST', marginPct: m, message: 'Discount takes this item below cost.' };
  if (m < thresholdPct) return { level: 'LOW_MARGIN', marginPct: m, message: `Margin ${m.toFixed(1)}% is below the ${thresholdPct}% threshold.` };
  return { level: 'OK', marginPct: m, message: null };
}

export const PROMOTION_TYPES = ['PERCENT_OFF', 'AMOUNT_OFF', 'FIXED_PRICE'] as const;
export type PromotionType = (typeof PROMOTION_TYPES)[number];

export interface PromotionLike {
  id: string;
  name: string;
  type: PromotionType;
  value: number;
}

/** Unit price after applying a promotion; never negative. */
export function applyPromotion(unitPrice: Cents, promo: PromotionLike): Cents {
  switch (promo.type) {
    case 'PERCENT_OFF':
      return Math.max(0, Math.round(unitPrice * (1 - promo.value / 100)));
    case 'AMOUNT_OFF':
      return Math.max(0, unitPrice - promo.value);
    case 'FIXED_PRICE':
      return Math.min(unitPrice, Math.max(0, promo.value));
  }
}

/** Choose the promotion that gives the customer the lowest price. */
export function bestPromotion<P extends PromotionLike>(unitPrice: Cents, promos: readonly P[]): { promo: P; price: Cents } | null {
  let best: { promo: P; price: Cents } | null = null;
  for (const promo of promos) {
    const price = applyPromotion(unitPrice, promo);
    if (price < unitPrice && (!best || price < best.price)) best = { promo, price };
  }
  return best;
}
