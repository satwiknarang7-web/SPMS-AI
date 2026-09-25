import { conditionFor, priceScript, rankCandidates, resolveDispenseRule, runSafetyChecks, safetyNetThreshold, type ConcessionType, type ConcurrentMedication, type InteractionRule, type PatientAllergy, type SafetyAlert, type ScriptType } from '@segue/shared';
import { json, type Db } from '../../../core/db';
import { appliedDispenseRules, drugConfigForStore, effectiveCost, effectiveRetail, storeGroups } from '../../../core/store-config';

type DrugRow = NonNullable<Awaited<ReturnType<Db['drug']['findUnique']>>>;
type PatientRow = NonNullable<Awaited<ReturnType<Db['patient']['findUnique']>>>;

/** Medicines supplied to the patient in the last 180 days — the basis for interaction checks. */
export async function currentMedications(db: Db, patientId: string, excludeScriptId?: string) {
  const since = new Date(Date.now() - 180 * 86_400_000);
  const scripts = await db.prescription.findMany({
    where: { patientId, status: { in: ['READY', 'COLLECTED'] }, dispensedAt: { gte: since }, id: excludeScriptId ? { not: excludeScriptId } : undefined },
    include: { drug: true },
    orderBy: { dispensedAt: 'desc' },
  });
  const seen = new Set<string>();
  return scripts
    .filter((s) => (seen.has(s.drugId) ? false : (seen.add(s.drugId), true)))
    .map((s) => ({
      name: `${s.drug.brandName} ${s.drug.strength}`,
      ingredient: s.drug.ingredient,
      drugClass: s.drug.drugClass,
      lastDispensedAt: s.dispensedAt!,
      scriptId: s.id,
    }));
}

const safetyDrug = (drug: Pick<DrugRow, 'brandName' | 'strength' | 'ingredient' | 'drugClass'>): ConcurrentMedication => ({
  name: `${drug.brandName} ${drug.strength}`,
  ingredient: drug.ingredient,
  drugClass: drug.drugClass,
});

/** Undispensed siblings on the same intake, so a final check still sees them before they are supplied. */
export async function batchSiblings(db: Db, batchId: string | null | undefined, excludeScriptId?: string): Promise<ConcurrentMedication[]> {
  if (!batchId) return [];
  const rows = await db.prescription.findMany({
    where: { batchId, id: excludeScriptId ? { not: excludeScriptId } : undefined, status: { in: ['IN_PROGRESS', 'AWAITING_CHECK', 'DEFERRED'] } },
    include: { drug: true },
  });
  return rows.map((r) => safetyDrug(r.drug));
}

export async function safetyFor(
  db: Db,
  patient: PatientRow,
  drug: DrugRow,
  opts: { excludeScriptId?: string; previousSupplyAt?: Date | null; concurrent?: readonly ConcurrentMedication[] } = {},
): Promise<SafetyAlert[]> {
  const [meds, interactions] = await Promise.all([
    currentMedications(db, patient.id, opts.excludeScriptId),
    db.drugInteraction.findMany({ where: { OR: [{ ingredientA: drug.ingredient }, { ingredientB: drug.ingredient }] } }),
  ]);
  return runSafetyChecks({
    drug: { ...safetyDrug(drug), schedule: drug.schedule },
    allergies: json.parse<PatientAllergy[]>(patient.allergies, []),
    currentMedications: meds,
    concurrentMedications: opts.concurrent ?? [],
    interactions: interactions as InteractionRule[],
    patientAlerts: json.parse<string[]>(patient.alerts, []),
    previousSupplyAt: opts.previousSupplyAt ?? null,
    minRepeatIntervalDays: drug.minRepeatDays ?? undefined,
  });
}

/** The other items on an intake, as seen from item `index`. */
export const othersOnIntake = <T extends { brandName: string; strength: string; ingredient: string; drugClass: string | null }>(drugs: readonly T[], index: number) =>
  drugs.filter((_, i) => i !== index).map(safetyDrug);

export interface QuoteInput {
  tenantId: string;
  storeId: string;
  patient: PatientRow;
  drug: DrugRow;
  productId: string | null;
  scriptType: ScriptType;
  quantity: number;
}

export async function priceFor(db: Db, input: QuoteInput) {
  const concession = input.patient.concessionType as ConcessionType;
  const safetyNetReached = input.patient.safetyNetTotal >= safetyNetThreshold(concession);
  const [rules, groups, product] = await Promise.all([
    appliedDispenseRules(db, input.tenantId, input.storeId),
    storeGroups(db, input.storeId),
    input.productId ? db.product.findFirst({ where: { id: input.productId, tenantId: input.tenantId }, include: { stores: { where: { storeId: input.storeId } } } }) : null,
  ]);
  const rule = resolveDispenseRule(rules, groups, conditionFor(input.scriptType, concession), input.drug.drugClass);
  const costPerPack = product ? effectiveCost(product, product.stores[0]) : 0;
  const price = priceScript({
    scriptType: input.scriptType,
    concession,
    safetyNetReached,
    quantity: input.quantity,
    packSize: input.drug.packSize,
    costPerPack,
    dpmq: input.scriptType === 'PRIVATE' ? null : input.drug.dpmq,
    brandPremium: input.drug.brandPremium,
    rule,
  });
  const ruleGroup = rule ? groups.find((g) => g.id === rule.groupId) : undefined;
  return { ...price, safetyNetReached, ruleGroup: ruleGroup?.name ?? null, packs: Math.max(1, Math.ceil(input.quantity / Math.max(1, input.drug.packSize))) };
}

/**
 * Drug search with generic-substitution ranking. Drugs sharing generic name, strength and
 * form are substitutable; within each set the store's HQ-assigned strategy and item flags
 * decide the display order (HQ-DR-01..03).
 */
export async function searchDrugs(db: Db, tenantId: string, storeId: string, term: string) {
  const t = term.trim();
  const matches = await db.drug.findMany({
    where: { tenantId, OR: [{ genericName: { contains: t } }, { brandName: { contains: t } }, { ingredient: { contains: t } }, { pbsCode: t }] },
    take: 40,
  });
  if (matches.length === 0) return [];
  // Widen to every substitutable brand of the matched generics.
  const keys = [...new Set(matches.map((d) => `${d.genericName}|${d.strength}|${d.form}`))];
  const all = await db.drug.findMany({
    where: { tenantId, OR: keys.map((k) => { const [genericName, strength, form] = k.split('|'); return { genericName, strength, form }; }) },
    include: { products: { where: { isActive: true }, include: { stores: { where: { storeId } } } } },
  });
  const cfg = await drugConfigForStore(db, storeId);

  return keys.map((key) => {
    const [genericName, strength, form] = key.split('|');
    const members = all.filter((d) => `${d.genericName}|${d.strength}|${d.form}` === key);
    const candidates = members.map((d) => {
      const p = d.products[0];
      const sp = p?.stores[0];
      return {
        id: d.id,
        name: d.brandName,
        cost: p ? effectiveCost(p, sp) : 0,
        price: p ? effectiveRetail(p, sp) : 0,
        onHand: sp?.onHand ?? 0,
        flag: (cfg.flags.get(d.id)?.flag ?? null) as 'PREFERRED' | 'RESTRICTED' | 'EXCLUDED' | null,
        drug: d,
        productId: p?.id ?? null,
        barcode: p?.barcode ?? null,
      };
    });
    const ranked = rankCandidates(candidates, cfg.basis);
    const excluded = candidates.filter((c) => c.flag === 'EXCLUDED').map((c) => c.name);
    return {
      genericName,
      strength,
      form,
      basis: cfg.basis,
      excluded,
      items: ranked.map((r) => ({
        rank: r.rank,
        reason: r.reason,
        flag: r.candidate.flag,
        drugId: r.candidate.id,
        productId: r.candidate.productId,
        barcode: r.candidate.barcode,
        brandName: r.candidate.drug.brandName,
        schedule: r.candidate.drug.schedule,
        drugClass: r.candidate.drug.drugClass,
        pbsCode: r.candidate.drug.pbsCode,
        packSize: r.candidate.drug.packSize,
        dpmq: r.candidate.drug.dpmq,
        brandPremium: r.candidate.drug.brandPremium,
        maxQuantity: r.candidate.drug.maxQuantity,
        maxRepeats: r.candidate.drug.maxRepeats,
        cost: r.candidate.cost,
        onHand: r.candidate.onHand,
      })),
    };
  });
}
