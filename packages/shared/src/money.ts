/**
 * All monetary values in Segue are integer cents (AUD) to avoid floating point drift.
 * Retail prices are GST-inclusive, as is standard in Australia.
 */
export type Cents = number;

export const GST_RATE = 0.1;

const formatter = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });

export function formatCents(cents: Cents | null | undefined): string {
  if (cents == null || Number.isNaN(cents)) return '—';
  return formatter.format(cents / 100);
}

export function toCents(dollars: number | string): Cents {
  const n = typeof dollars === 'string' ? Number.parseFloat(dollars) : dollars;
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${dollars}`);
  return Math.round(n * 100);
}

/** GST component contained in a GST-inclusive amount (1/11th). */
export function gstComponent(inclusiveCents: Cents): Cents {
  return Math.round(inclusiveCents / 11);
}

/** Round to the nearest 5 cents — Australian cash rounding. */
export function cashRound(cents: Cents): Cents {
  return Math.round(cents / 5) * 5;
}

export function marginPct(sellCents: Cents, costCents: Cents): number {
  if (sellCents <= 0) return 0;
  return ((sellCents - costCents) / sellCents) * 100;
}
