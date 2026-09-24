import {
  bestPromotion,
  isRole,
  sortByPrecedence,
  type DispensePricingRule,
  type GroupRef,
  type PromotionType,
  type RankingBasis,
} from '@segue/shared';
import { json, type Db } from './db';

/**
 * Resolves the configuration HQ has distributed to a particular store. A setting only
 * takes effect at a store once its publication has been APPLIED there by the sync worker —
 * the same semantics as a remote store agent receiving the update.
 */

export async function storeGroups(db: Db, storeId: string): Promise<(GroupRef & { name: string })[]> {
  const members = await db.storeGroupMember.findMany({ where: { storeId }, include: { group: true } });
  return sortByPrecedence(members.map((m) => ({ id: m.group.id, name: m.group.name, priority: m.group.priority, createdAt: m.group.createdAt })));
}

async function appliedPublicationIds(db: Db, storeId: string, kind: string): Promise<Set<string>> {
  const targets = await db.publicationTarget.findMany({
    where: { storeId, status: 'APPLIED', publication: { kind, status: 'PUBLISHED', effectiveAt: { lte: new Date() } } },
    select: { publicationId: true },
  });
  return new Set(targets.map((t) => t.publicationId));
}

export async function appliedDispenseRules(db: Db, tenantId: string, storeId: string): Promise<DispensePricingRule[]> {
  const applied = await appliedPublicationIds(db, storeId, 'DISPENSE_PRICING');
  if (applied.size === 0) return [];
  const rules = await db.dispensePricingRule.findMany({
    where: { tenantId, status: 'PUBLISHED', publicationId: { in: [...applied] } },
  });
  return rules.map((r) => ({
    id: r.id,
    groupId: r.groupId,
    condition: r.condition as DispensePricingRule['condition'],
    drugClass: r.drugClass,
    markupPct: r.markupPct,
    dispensingFee: r.dispensingFee,
    copayDiscount: r.copayDiscount,
    minMarginPct: r.minMarginPct,
  }));
}

export interface ActivePromotion {
  id: string;
  name: string;
  type: PromotionType;
  value: number;
  productIds: string[];
  endsAt: Date;
}

export async function activePromotions(db: Db, tenantId: string, storeId: string): Promise<ActivePromotion[]> {
  const applied = await appliedPublicationIds(db, storeId, 'PROMOTION');
  if (applied.size === 0) return [];
  const now = new Date();
  const promos = await db.promotion.findMany({
    where: { tenantId, status: 'PUBLISHED', publicationId: { in: [...applied] }, startsAt: { lte: now }, endsAt: { gte: now } },
  });
  return promos
    .filter((p) => json.parse<string[]>(p.storeIds, []).includes(storeId))
    .map((p) => ({ id: p.id, name: p.name, type: p.type as PromotionType, value: p.value, productIds: json.parse<string[]>(p.productIds, []), endsAt: p.endsAt }));
}

export function promotionFor(productId: string, unitPrice: number, promos: readonly ActivePromotion[]) {
  return bestPromotion(unitPrice, promos.filter((p) => p.productIds.includes(productId)));
}

/** Ranking basis and item flags that apply to a store, honouring group precedence. */
export async function drugConfigForStore(db: Db, storeId: string) {
  const groups = await storeGroups(db, storeId);
  const groupIds = groups.map((g) => g.id);
  const [strategies, flags] = await Promise.all([
    db.rankingStrategy.findMany({ where: { groupId: { in: groupIds } } }),
    db.drugGroupFlag.findMany({ where: { groupId: { in: groupIds } } }),
  ]);
  const order = new Map(groupIds.map((id, i) => [id, i] as const));
  const byPrecedence = <T extends { groupId: string }>(a: T, b: T) => (order.get(a.groupId) ?? 0) - (order.get(b.groupId) ?? 0);
  const strategy = [...strategies].sort(byPrecedence)[0];
  const flagMap = new Map<string, { flag: string; groupId: string }>();
  for (const f of [...flags].sort(byPrecedence)) if (!flagMap.has(f.drugId)) flagMap.set(f.drugId, { flag: f.flag, groupId: f.groupId });
  return {
    basis: (strategy?.basis ?? 'LOWEST_COST') as RankingBasis,
    strategyGroupId: strategy?.groupId ?? null,
    flags: flagMap,
    groups,
  };
}

/** Effective selling price at a store: store price if set, otherwise the HQ master price. */
export const effectiveRetail = (product: { retailPrice: number }, sp?: { retailPrice: number | null } | null) => sp?.retailPrice ?? product.retailPrice;
export const effectiveCost = (product: { costPrice: number }, sp?: { costPrice: number | null } | null) => sp?.costPrice ?? product.costPrice;

export interface TenantSettings {
  surchargePct: number;
  marginThresholdPct: number;
  loyaltyPointsPerDollar: number;
}

export const DEFAULT_TENANT_SETTINGS: TenantSettings = { surchargePct: 1.5, marginThresholdPct: 20, loyaltyPointsPerDollar: 1 };

export async function tenantSettings(db: Db, tenantId: string): Promise<TenantSettings> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  return { ...DEFAULT_TENANT_SETTINGS, ...json.parse<Partial<TenantSettings>>(t?.settings, {}) };
}

/** Store ids the caller's roles give access to. Tenant-wide roles see every store. */
export async function accessibleStores(db: Db, userId: string, tenantId: string) {
  const roles = await db.userRole.findMany({ where: { userId } });
  const validRoles = roles.filter((r) => isRole(r.role));
  const tenantWide = validRoles.some((r) => r.storeId === null);
  return db.store.findMany({
    where: { tenantId, ...(tenantWide ? {} : { id: { in: validRoles.map((r) => r.storeId!).filter(Boolean) } }) },
    orderBy: { code: 'asc' },
  });
}

/** Next sequential document number for a store, e.g. SALE-000123. Call inside a transaction. */
export async function nextNumber(count: () => Promise<number>, prefix: string, pad = 6) {
  const n = (await count()) + 1;
  return `${prefix}${String(n).padStart(pad, '0')}`;
}
