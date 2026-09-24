import { gstComponent, type Cents } from '../money';

export const TENDER_TYPES = ['CASH', 'EFTPOS', 'ACCOUNT', 'GIFT_VOUCHER', 'STORE_CREDIT'] as const;
export type TenderType = (typeof TENDER_TYPES)[number];

export const TENDER_LABELS: Record<TenderType, string> = {
  CASH: 'Cash',
  EFTPOS: 'EFTPOS',
  ACCOUNT: 'Charge to account',
  GIFT_VOUCHER: 'Gift voucher',
  STORE_CREDIT: 'Store credit',
};

export interface CartLine {
  unitPrice: Cents;
  quantity: number;
  /** Total discount on the line (not per unit). */
  discount: Cents;
  gstFree: boolean;
  /** PBS-subsidised script lines are excluded from merchant surcharging. */
  isPbs: boolean;
}

export interface CartTotals {
  subtotal: Cents;
  discountTotal: Cents;
  total: Cents;
  gst: Cents;
  pbsTotal: Cents;
  nonPbsTotal: Cents;
}

export const lineTotal = (l: CartLine): Cents => Math.max(0, l.unitPrice * l.quantity - l.discount);

export function cartTotals(lines: readonly CartLine[]): CartTotals {
  let subtotal = 0;
  let discountTotal = 0;
  let gst = 0;
  let pbsTotal = 0;
  for (const l of lines) {
    subtotal += l.unitPrice * l.quantity;
    discountTotal += Math.min(l.discount, l.unitPrice * l.quantity);
    const lt = lineTotal(l);
    if (!l.gstFree) gst += gstComponent(lt);
    if (l.isPbs) pbsTotal += lt;
  }
  const total = subtotal - discountTotal;
  return { subtotal, discountTotal, total, gst, pbsTotal, nonPbsTotal: total - pbsTotal };
}

/**
 * Card surcharge applies only to the non-PBS portion of a card payment. Government
 * subsidised PBS scripts (General, Concession, Repatriation) are never surcharged.
 */
export function cardSurcharge(cardAmount: Cents, nonPbsTotal: Cents, ratePct: number): Cents {
  if (ratePct <= 0 || cardAmount <= 0) return 0;
  const base = Math.min(cardAmount, Math.max(0, nonPbsTotal));
  return Math.round((base * ratePct) / 100);
}

export interface TenderInput {
  type: TenderType;
  amount: Cents;
}

export interface TenderResult {
  ok: boolean;
  paid: Cents;
  change: Cents;
  outstanding: Cents;
  error: string | null;
}

/** Validate a (possibly split) tender against the amount due. Only cash may be over-tendered. */
export function settleTenders(amountDue: Cents, tenders: readonly TenderInput[]): TenderResult {
  if (tenders.some((t) => t.amount <= 0)) return { ok: false, paid: 0, change: 0, outstanding: amountDue, error: 'Tender amounts must be positive.' };
  const paid = tenders.reduce((s, t) => s + t.amount, 0);
  const nonCash = tenders.filter((t) => t.type !== 'CASH').reduce((s, t) => s + t.amount, 0);
  if (nonCash > amountDue) return { ok: false, paid, change: 0, outstanding: 0, error: 'Non-cash tenders cannot exceed the amount due.' };
  if (paid < amountDue) return { ok: false, paid, change: 0, outstanding: amountDue - paid, error: 'Payment does not cover the amount due.' };
  return { ok: true, paid, change: paid - amountDue, outstanding: 0, error: null };
}

export interface ShiftBalanceInput {
  openingFloat: Cents;
  cashSales: Cents;
  cashRefunds: Cents;
  paidIn: Cents;
  paidOut: Cents;
}

export const expectedCash = (s: ShiftBalanceInput): Cents => s.openingFloat + s.cashSales - s.cashRefunds + s.paidIn - s.paidOut;
