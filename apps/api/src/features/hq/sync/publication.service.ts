import type { Prisma } from '@prisma/client';
import { audit, type AuditActor } from '../../../core/audit';
import { json, prisma, tx, type Db } from '../../../core/db';
import { conflict, notFound } from '../../../core/errors';

/**
 * HQ configuration distribution (HQ-SY-01..03, HQ-SE-04).
 *
 *   publish ──► activate (at effectiveAt: central effects, e.g. master price) ──► apply per store
 *                                                                              (queued + retried
 *                                                                               while offline)
 *   rollback ──► restores central state and queues a ROLLBACK publication that restores each
 *                store to the exact state captured just before the original was applied.
 */
export type PublicationKind = 'RETAIL_PRICE' | 'DISPENSE_PRICING' | 'PROMOTION' | 'DRUG_CONFIG' | 'PRICE_FILE' | 'ROLLBACK';

export interface RetailPricePayload {
  allStores: boolean;
  changes: { productId: string; retailPrice: number }[];
}
export interface PriceFilePayload {
  priceFileId: string;
  changes: { productId: string; cost: number; retail: number }[];
}
export interface DispensePricingPayload {
  ruleId: string;
}
export interface PromotionPayload {
  promotionId: string;
}
export interface DrugConfigPayload {
  groupId: string;
  basis: string | null;
  flags: { drugId: string; flag: string | null }[];
}
export interface RollbackPayload {
  of: string;
  kind: PublicationKind;
}

interface PublishInput {
  tenantId: string;
  kind: PublicationKind;
  title: string;
  payload: unknown;
  storeIds: string[];
  effectiveAt?: Date | null;
  createdById: string;
  rollbackOfId?: string;
}

export async function createPublication(db: Db, input: PublishInput) {
  if (input.storeIds.length === 0) throw conflict('No target stores selected');
  const effectiveAt = input.effectiveAt && input.effectiveAt > new Date() ? input.effectiveAt : new Date();
  return db.publication.create({
    data: {
      tenantId: input.tenantId,
      kind: input.kind,
      title: input.title,
      payload: json.stringify(input.payload),
      effectiveAt,
      createdById: input.createdById,
      rollbackOfId: input.rollbackOfId ?? null,
      targets: { create: [...new Set(input.storeIds)].map((storeId) => ({ storeId })) },
    },
    include: { targets: true },
  });
}

/* ------------------------------ Activation ------------------------------ */

type Tx = Prisma.TransactionClient;
type PublicationRow = NonNullable<Awaited<ReturnType<Tx['publication']['findUnique']>>>;

/** Central effects that happen once, when the publication becomes effective. */
async function activate(db: Tx, pub: PublicationRow) {
  const pendingStores = (await db.publicationTarget.findMany({ where: { publicationId: pub.id, status: 'QUEUED' }, select: { storeId: true } })).map((t) => t.storeId);
  let rollback: unknown = null;

  switch (pub.kind as PublicationKind) {
    case 'RETAIL_PRICE': {
      const p = json.parse<RetailPricePayload>(pub.payload, { allStores: false, changes: [] });
      if (p.allStores) {
        const products = await db.product.findMany({ where: { id: { in: p.changes.map((c) => c.productId) } } });
        // Stores that have not received the update yet keep charging the old price until they do.
        await pinUntilApplied(db, pendingStores, products.map((x) => ({ productId: x.id, retail: x.retailPrice, cost: null })));
        for (const c of p.changes) {
          const old = products.find((x) => x.id === c.productId);
          await db.product.update({ where: { id: c.productId }, data: { retailPrice: c.retailPrice } });
          await db.priceHistory.create({ data: { productId: c.productId, storeId: null, oldRetail: old?.retailPrice, newRetail: c.retailPrice, source: 'HQ_PUBLISH', refId: pub.id } });
        }
        rollback = { master: Object.fromEntries(products.map((x) => [x.id, { retail: x.retailPrice }])) };
      }
      break;
    }
    case 'PRICE_FILE': {
      const p = json.parse<PriceFilePayload>(pub.payload, { priceFileId: '', changes: [] });
      const products = await db.product.findMany({ where: { id: { in: p.changes.map((c) => c.productId) } } });
      await pinUntilApplied(db, pendingStores, products.map((x) => ({ productId: x.id, retail: x.retailPrice, cost: x.costPrice })));
      for (const c of p.changes) {
        const old = products.find((x) => x.id === c.productId);
        await db.product.update({ where: { id: c.productId }, data: { costPrice: c.cost, retailPrice: c.retail } });
        await db.priceHistory.create({ data: { productId: c.productId, storeId: null, oldCost: old?.costPrice, newCost: c.cost, oldRetail: old?.retailPrice, newRetail: c.retail, source: 'PRICE_FILE', refId: pub.id } });
      }
      const file = await db.priceFile.findUnique({ where: { id: p.priceFileId } });
      if (file) {
        for (const c of p.changes) await db.productSupplier.updateMany({ where: { productId: c.productId, supplierId: file.supplierId }, data: { cost: c.cost } });
        await db.priceFile.update({ where: { id: file.id }, data: { status: 'PUBLISHED' } });
      }
      rollback = { master: Object.fromEntries(products.map((x) => [x.id, { retail: x.retailPrice, cost: x.costPrice }])) };
      break;
    }
    case 'DISPENSE_PRICING': {
      const { ruleId } = json.parse<DispensePricingPayload>(pub.payload, { ruleId: '' });
      const rule = await db.dispensePricingRule.findUnique({ where: { id: ruleId } });
      if (!rule) break;
      // A newer rule for the same group/condition/class supersedes the previous one.
      const superseded = await db.dispensePricingRule.findMany({
        where: { tenantId: rule.tenantId, groupId: rule.groupId, condition: rule.condition, drugClass: rule.drugClass, status: 'PUBLISHED', id: { not: rule.id } },
      });
      await db.dispensePricingRule.updateMany({ where: { id: { in: superseded.map((r) => r.id) } }, data: { status: 'SUPERSEDED' } });
      await db.dispensePricingRule.update({ where: { id: rule.id }, data: { status: 'PUBLISHED' } });
      rollback = { superseded: superseded.map((r) => r.id) };
      break;
    }
    case 'PROMOTION': {
      const { promotionId } = json.parse<PromotionPayload>(pub.payload, { promotionId: '' });
      await db.promotion.update({ where: { id: promotionId }, data: { status: 'PUBLISHED' } });
      break;
    }
    case 'DRUG_CONFIG': {
      const p = json.parse<DrugConfigPayload>(pub.payload, { groupId: '', basis: null, flags: [] });
      const prevStrategy = await db.rankingStrategy.findUnique({ where: { groupId: p.groupId } });
      const prevFlags = await db.drugGroupFlag.findMany({ where: { groupId: p.groupId, drugId: { in: p.flags.map((f) => f.drugId) } } });
      if (p.basis) {
        const group = await db.storeGroup.findUniqueOrThrow({ where: { id: p.groupId } });
        await db.rankingStrategy.upsert({ where: { groupId: p.groupId }, create: { groupId: p.groupId, tenantId: group.tenantId, basis: p.basis }, update: { basis: p.basis } });
      }
      await applyFlags(db, p.groupId, p.flags);
      rollback = {
        basis: prevStrategy?.basis ?? null,
        flags: p.flags.map((f) => ({ drugId: f.drugId, flag: prevFlags.find((x) => x.drugId === f.drugId)?.flag ?? null })),
      };
      break;
    }
    case 'ROLLBACK':
      // Central restoration happens synchronously in rollbackPublication().
      break;
  }
  await db.publication.update({ where: { id: pub.id }, data: { activatedAt: new Date(), rollback: rollback == null ? pub.rollback : json.stringify(rollback) } });
}

async function applyFlags(db: Tx, groupId: string, flags: { drugId: string; flag: string | null }[]) {
  for (const f of flags) {
    if (f.flag) await db.drugGroupFlag.upsert({ where: { groupId_drugId: { groupId, drugId: f.drugId } }, create: { groupId, drugId: f.drugId, flag: f.flag }, update: { flag: f.flag } });
    else await db.drugGroupFlag.deleteMany({ where: { groupId, drugId: f.drugId } });
  }
}

/** Freeze the current effective price at stores that are still waiting for delivery. */
async function pinUntilApplied(db: Tx, storeIds: string[], items: { productId: string; retail: number; cost: number | null }[]) {
  for (const storeId of storeIds) {
    for (const it of items) {
      const sp = await db.storeProduct.findUnique({ where: { storeId_productId: { storeId, productId: it.productId } } });
      if (!sp) continue;
      await db.storeProduct.update({
        where: { storeId_productId: { storeId, productId: it.productId } },
        data: { retailPrice: sp.retailPrice ?? it.retail, costPrice: it.cost == null ? undefined : sp.costPrice ?? it.cost },
      });
    }
  }
}

/* ------------------------------ Store apply ------------------------------ */

async function applyToStore(db: Tx, pub: PublicationRow, storeId: string): Promise<unknown> {
  switch (pub.kind as PublicationKind) {
    case 'RETAIL_PRICE': {
      const p = json.parse<RetailPricePayload>(pub.payload, { allStores: false, changes: [] });
      const previous: Record<string, number | null> = {};
      for (const c of p.changes) {
        const sp = await db.storeProduct.findUnique({ where: { storeId_productId: { storeId, productId: c.productId } } });
        previous[c.productId] = sp?.retailPrice ?? null;
        // All-store publishes realign the store with the HQ master; subset publishes set a store price.
        const retailPrice = p.allStores ? null : c.retailPrice;
        await db.storeProduct.upsert({
          where: { storeId_productId: { storeId, productId: c.productId } },
          create: { storeId, productId: c.productId, retailPrice },
          update: { retailPrice },
        });
        if (previous[c.productId] !== c.retailPrice) {
          await db.priceHistory.create({ data: { productId: c.productId, storeId, oldRetail: previous[c.productId], newRetail: c.retailPrice, source: 'HQ_PUBLISH', refId: pub.id } });
        }
      }
      return { retail: previous };
    }
    case 'PRICE_FILE': {
      const p = json.parse<PriceFilePayload>(pub.payload, { priceFileId: '', changes: [] });
      const previous: Record<string, { retail: number | null; cost: number | null }> = {};
      for (const c of p.changes) {
        const sp = await db.storeProduct.findUnique({ where: { storeId_productId: { storeId, productId: c.productId } } });
        if (!sp) continue;
        previous[c.productId] = { retail: sp.retailPrice, cost: sp.costPrice };
        await db.storeProduct.update({ where: { storeId_productId: { storeId, productId: c.productId } }, data: { retailPrice: null, costPrice: null } });
      }
      return { prices: previous };
    }
    case 'ROLLBACK': {
      const { of } = json.parse<RollbackPayload>(pub.payload, { of: '', kind: 'ROLLBACK' });
      const original = await db.publicationTarget.findUnique({ where: { publicationId_storeId: { publicationId: of, storeId } } });
      const prev = json.parse<{ retail?: Record<string, number | null>; prices?: Record<string, { retail: number | null; cost: number | null }> }>(original?.previous, {});
      for (const [productId, retailPrice] of Object.entries(prev.retail ?? {})) {
        await db.storeProduct.updateMany({ where: { storeId, productId }, data: { retailPrice } });
      }
      for (const [productId, v] of Object.entries(prev.prices ?? {})) {
        await db.storeProduct.updateMany({ where: { storeId, productId }, data: { retailPrice: v.retail, costPrice: v.cost } });
      }
      return null;
    }
    default:
      // Rules, promotions and drug configuration are read by the store once delivery is APPLIED.
      return null;
  }
}

/* ------------------------------ Sync worker ------------------------------ */

const BACKOFF_BASE_MS = 15_000;
const BACKOFF_MAX_MS = 15 * 60_000;

export interface SyncRunResult {
  activated: number;
  applied: number;
  deferred: number;
  failed: number;
}

/**
 * One pass of the sync worker: activate due publications, then deliver queued targets.
 * Offline or suspended stores are retried with exponential backoff (HQ-SY-02).
 */
export async function runSync(opts: { tenantId?: string; force?: boolean } = {}): Promise<SyncRunResult> {
  const now = new Date();
  const result: SyncRunResult = { activated: 0, applied: 0, deferred: 0, failed: 0 };

  const due = await prisma.publication.findMany({ where: { tenantId: opts.tenantId, status: 'PUBLISHED', activatedAt: null, effectiveAt: { lte: now } }, orderBy: { effectiveAt: 'asc' } });
  for (const pub of due) {
    await tx((db) => activate(db, pub));
    result.activated++;
  }

  const queued = await prisma.publicationTarget.findMany({
    where: { status: 'QUEUED', publication: { tenantId: opts.tenantId, status: 'PUBLISHED', activatedAt: { not: null } } },
    include: { publication: true },
    orderBy: { publication: { effectiveAt: 'asc' } },
  });
  const stores = new Map((await prisma.store.findMany({ where: { id: { in: [...new Set(queued.map((q) => q.storeId))] } } })).map((s) => [s.id, s]));

  for (const target of queued) {
    const store = stores.get(target.storeId);
    if (!opts.force && target.lastAttemptAt) {
      const wait = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, target.attempts - 1), BACKOFF_MAX_MS);
      if (now.getTime() - target.lastAttemptAt.getTime() < wait) {
        result.deferred++;
        continue;
      }
    }
    if (!store || store.status !== 'ACTIVE' || !store.online) {
      await prisma.publicationTarget.update({
        where: { id: target.id },
        data: { attempts: { increment: 1 }, lastAttemptAt: now, error: !store ? 'Store removed' : store.status !== 'ACTIVE' ? 'Store suspended' : 'Store offline — queued for retry' },
      });
      result.deferred++;
      continue;
    }
    try {
      await tx(async (db) => {
        const previous = await applyToStore(db, target.publication, target.storeId);
        await db.publicationTarget.update({
          where: { id: target.id },
          data: { status: 'APPLIED', appliedAt: new Date(), attempts: { increment: 1 }, lastAttemptAt: now, error: null,
            // Keep the first capture: a re-publish must not overwrite the true pre-change state.
            previous: target.previous ?? (previous == null ? null : json.stringify(previous)) },
        });
        await db.store.update({ where: { id: target.storeId }, data: { lastSeenAt: now } });
      });
      result.applied++;
    } catch (err) {
      await prisma.publicationTarget.update({
        where: { id: target.id },
        data: { status: target.attempts >= 9 ? 'FAILED' : 'QUEUED', attempts: { increment: 1 }, lastAttemptAt: now, error: (err as Error).message.slice(0, 500) },
      });
      result.failed++;
    }
  }
  return result;
}

/* -------------------------------- Rollback -------------------------------- */

export async function rollbackPublication(actor: AuditActor, tenantId: string, publicationId: string, userId: string) {
  return tx(async (db) => {
    const pub = await db.publication.findFirst({ where: { id: publicationId, tenantId }, include: { targets: true } });
    if (!pub) throw notFound('Publication');
    if (pub.kind === 'ROLLBACK') throw conflict('A rollback cannot itself be rolled back — publish the change again instead');
    if (pub.status === 'ROLLED_BACK') throw conflict('Already rolled back');

    const rb = json.parse<{ master?: Record<string, { retail?: number; cost?: number }>; superseded?: string[]; basis?: string | null; flags?: { drugId: string; flag: string | null }[] }>(pub.rollback, {});

    // 1. Restore central state.
    if (pub.activatedAt) {
      switch (pub.kind as PublicationKind) {
        case 'RETAIL_PRICE':
        case 'PRICE_FILE':
          for (const [productId, v] of Object.entries(rb.master ?? {})) {
            await db.product.update({ where: { id: productId }, data: { retailPrice: v.retail, costPrice: v.cost } });
            await db.priceHistory.create({ data: { productId, storeId: null, newRetail: v.retail, newCost: v.cost, source: 'ROLLBACK', refId: pub.id } });
          }
          if (pub.kind === 'PRICE_FILE') {
            const { priceFileId } = json.parse<PriceFilePayload>(pub.payload, { priceFileId: '', changes: [] });
            await db.priceFile.updateMany({ where: { id: priceFileId }, data: { status: 'ROLLED_BACK' } });
          }
          break;
        case 'DISPENSE_PRICING': {
          const { ruleId } = json.parse<DispensePricingPayload>(pub.payload, { ruleId: '' });
          await db.dispensePricingRule.update({ where: { id: ruleId }, data: { status: 'ROLLED_BACK' } });
          if (rb.superseded?.length) await db.dispensePricingRule.updateMany({ where: { id: { in: rb.superseded } }, data: { status: 'PUBLISHED' } });
          break;
        }
        case 'PROMOTION': {
          const { promotionId } = json.parse<PromotionPayload>(pub.payload, { promotionId: '' });
          await db.promotion.update({ where: { id: promotionId }, data: { status: 'ROLLED_BACK' } });
          break;
        }
        case 'DRUG_CONFIG': {
          const p = json.parse<DrugConfigPayload>(pub.payload, { groupId: '', basis: null, flags: [] });
          if (p.basis) {
            if (rb.basis) await db.rankingStrategy.update({ where: { groupId: p.groupId }, data: { basis: rb.basis } });
            else await db.rankingStrategy.deleteMany({ where: { groupId: p.groupId } });
          }
          await applyFlags(db, p.groupId, rb.flags ?? []);
          break;
        }
      }
    } else if (pub.kind === 'DISPENSE_PRICING' || pub.kind === 'PROMOTION') {
      // Scheduled but never activated: simply withdraw it.
      const p = json.parse<DispensePricingPayload & PromotionPayload>(pub.payload, { ruleId: '', promotionId: '' });
      if (p.ruleId) await db.dispensePricingRule.update({ where: { id: p.ruleId }, data: { status: 'ROLLED_BACK' } });
      if (p.promotionId) await db.promotion.update({ where: { id: p.promotionId }, data: { status: 'ROLLED_BACK' } });
    }

    // 2. Stores that never received the change simply won't; stores that did get a restore.
    await db.publicationTarget.updateMany({ where: { publicationId: pub.id, status: { in: ['QUEUED', 'FAILED'] } }, data: { status: 'CANCELLED', error: 'Withdrawn by rollback' } });
    const appliedStores = pub.targets.filter((t) => t.status === 'APPLIED').map((t) => t.storeId);
    await db.publication.update({ where: { id: pub.id }, data: { status: 'ROLLED_BACK' } });

    let restore = null;
    if (appliedStores.length) {
      restore = await createPublication(db, {
        tenantId, kind: 'ROLLBACK', title: `Rollback: ${pub.title}`, payload: { of: pub.id, kind: pub.kind as PublicationKind } satisfies RollbackPayload,
        storeIds: appliedStores, createdById: userId, rollbackOfId: pub.id,
      });
    }
    await audit(db, actor, {
      module: 'HQ', action: 'publication.rollback', entityType: 'Publication', entityId: pub.id, storeId: null,
      summary: `Rolled back "${pub.title}" — ${appliedStores.length} store(s) will be restored`,
      before: { status: pub.status }, after: { status: 'ROLLED_BACK', restorePublicationId: restore?.id ?? null },
    });
    return { rolledBack: pub.id, restorePublication: restore?.id ?? null, storesToRestore: appliedStores.length };
  });
}

export async function republishToStore(actor: AuditActor, tenantId: string, publicationId: string, storeId: string) {
  return tx(async (db) => {
    const target = await db.publicationTarget.findFirst({ where: { publicationId, storeId, publication: { tenantId } }, include: { publication: true } });
    if (!target) throw notFound('Delivery target');
    if (target.publication.status !== 'PUBLISHED') throw conflict('Only active publications can be re-published');
    await db.publicationTarget.update({ where: { id: target.id }, data: { status: 'QUEUED', lastAttemptAt: null, error: null, attempts: 0 } });
    await audit(db, actor, { module: 'HQ', action: 'publication.republish', entityType: 'Publication', entityId: publicationId, storeId, summary: `Re-published "${target.publication.title}" to store` });
    return { queued: true };
  });
}

