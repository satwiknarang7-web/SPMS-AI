/**
 * Generic substitution and drug ranking (Dispense medicine selection, HQ-DR-01..03).
 * HQ assigns a ranking strategy and item flags to store groups; the store's dispense
 * search orders substitutable brands accordingly.
 */
export const RANKING_BASES = ['LOWEST_COST', 'HIGHEST_MARGIN', 'STOCK_ON_HAND'] as const;
export type RankingBasis = (typeof RANKING_BASES)[number];

export const DRUG_FLAGS = ['PREFERRED', 'RESTRICTED', 'EXCLUDED'] as const;
export type DrugFlag = (typeof DRUG_FLAGS)[number];

export interface RankCandidate {
  id: string;
  name: string;
  cost: number;
  price: number;
  onHand: number;
  flag: DrugFlag | null;
}

export interface RankedCandidate<C extends RankCandidate = RankCandidate> {
  candidate: C;
  rank: number;
  reason: string;
}

const FLAG_ORDER: Record<string, number> = { PREFERRED: 0, NONE: 1, RESTRICTED: 2 };

export function rankCandidates<C extends RankCandidate>(candidates: readonly C[], basis: RankingBasis): RankedCandidate<C>[] {
  const eligible = candidates.filter((c) => c.flag !== 'EXCLUDED');
  const score = (c: C) => {
    switch (basis) {
      case 'LOWEST_COST':
        return c.cost;
      case 'HIGHEST_MARGIN':
        return -(c.price - c.cost);
      case 'STOCK_ON_HAND':
        return -c.onHand;
    }
  };
  const sorted = [...eligible].sort((a, b) => {
    // In-stock items always come before out-of-stock items.
    const stock = Number(b.onHand > 0) - Number(a.onHand > 0);
    if (stock !== 0) return stock;
    const flag = (FLAG_ORDER[a.flag ?? 'NONE'] ?? 1) - (FLAG_ORDER[b.flag ?? 'NONE'] ?? 1);
    if (flag !== 0) return flag;
    const s = score(a) - score(b);
    if (s !== 0) return s;
    return a.name.localeCompare(b.name);
  });
  return sorted.map((candidate, i) => ({
    candidate,
    rank: i + 1,
    reason:
      candidate.onHand <= 0
        ? 'Out of stock'
        : candidate.flag === 'PREFERRED'
          ? 'Group preferred brand'
          : candidate.flag === 'RESTRICTED'
            ? 'Restricted by head office'
            : basis === 'LOWEST_COST'
              ? 'Lowest cost'
              : basis === 'HIGHEST_MARGIN'
                ? 'Highest margin'
                : 'Most stock on hand',
  }));
}
