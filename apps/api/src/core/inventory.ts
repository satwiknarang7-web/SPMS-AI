import type { Db } from './db';

export const STOCK_REASONS = ['RECEIPT', 'SALE', 'DISPENSE', 'ADJUSTMENT', 'STOCKTAKE', 'RETURN', 'WRITE_OFF', 'TRANSFER', 'LAYBY'] as const;
export type StockReason = (typeof STOCK_REASONS)[number];

export interface StockMove {
  storeId: string;
  productId: string;
  /** Signed quantity: negative reduces stock. */
  quantity: number;
  reason: StockReason;
  refType?: string;
  refId?: string;
  note?: string;
  userId?: string | null;
}

/**
 * The single write path for stock. Every module (Dispense, POS, Office) calls this, so the
 * running balance and the movement ledger can never disagree. Stock may go negative —
 * pharmacies must be able to sell/dispense what is physically present even if the
 * system count is wrong; the variance surfaces at stocktake.
 */
export async function moveStock(db: Db, move: StockMove) {
  if (move.quantity === 0) return null;
  await db.storeProduct.upsert({
    where: { storeId_productId: { storeId: move.storeId, productId: move.productId } },
    create: { storeId: move.storeId, productId: move.productId, onHand: move.quantity },
    update: { onHand: { increment: move.quantity } },
  });
  return db.stockMovement.create({
    data: {
      storeId: move.storeId,
      productId: move.productId,
      quantity: move.quantity,
      reason: move.reason,
      refType: move.refType,
      refId: move.refId,
      note: move.note,
      userId: move.userId ?? null,
    },
  });
}
