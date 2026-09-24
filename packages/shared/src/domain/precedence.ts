/**
 * Store group precedence (HQ-SG-04).
 *
 * A store may belong to several groups. When two groups supply a conflicting setting,
 * the winner is chosen deterministically:
 *   1. lowest `priority` number wins (priority 1 beats priority 10);
 *   2. on equal priority, the group created first wins;
 *   3. on identical timestamps, the lexicographically smaller id wins.
 * This rule is documented in docs/ARCHITECTURE.md and surfaced in the HQ UI.
 */
export interface GroupRef {
  id: string;
  name?: string;
  priority: number;
  createdAt: Date | string;
}

export function compareGroupPrecedence(a: GroupRef, b: GroupRef): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const ta = new Date(a.createdAt).getTime();
  const tb = new Date(b.createdAt).getTime();
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortByPrecedence<T extends GroupRef>(groups: readonly T[]): T[] {
  return [...groups].sort(compareGroupPrecedence);
}

/**
 * Pick the winning setting for a store from settings attached to groups.
 * `settings` are candidates keyed by the group they came from; `specificity` lets a
 * more specific setting (e.g. drug-class rule) beat a generic one *within* the same group
 * ordering pass — specificity is compared first, then group precedence.
 */
export function resolveSetting<S extends { groupId: string }>(
  settings: readonly S[],
  storeGroups: readonly GroupRef[],
  specificity: (s: S) => number = () => 0,
): S | undefined {
  const rank = new Map(sortByPrecedence(storeGroups).map((g, i) => [g.id, i] as const));
  const candidates = settings.filter((s) => rank.has(s.groupId));
  candidates.sort((a, b) => {
    const spec = specificity(b) - specificity(a);
    if (spec !== 0) return spec;
    return (rank.get(a.groupId) ?? 0) - (rank.get(b.groupId) ?? 0);
  });
  return candidates[0];
}
