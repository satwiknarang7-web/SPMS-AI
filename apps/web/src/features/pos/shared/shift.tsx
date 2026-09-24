'use client';

import { TENDER_LABELS, type TenderType } from '@segue/shared';
import { useQuery } from '@tanstack/react-query';
import { Printer, Wallet } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Card, Dialog, Field, Input, Loading } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { api } from '@/lib/api';
import { dateTime, money, parseMoney } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export const REGISTER_KEY = 'segue.register';

export const currentRegister = () => {
  try {
    return localStorage.getItem(REGISTER_KEY) ?? 'Register 1';
  } catch {
    return 'Register 1';
  }
};

export interface Shift {
  id: string;
  register: string;
  openedAt: string;
  openingFloat: number;
  status: string;
}

export interface ShiftSummary {
  salesCount: number;
  refundCount: number;
  grossSales: number;
  refunds: number;
  discounts: number;
  surcharge: number;
  gst: number;
  byTender: Record<string, number>;
  cashSales: number;
  cashRefunds: number;
  paidIn: number;
  paidOut: number;
  otherCashIn: number;
  noSales: number;
  scriptsCollected: number;
}

export function useCurrentShift() {
  const register = currentRegister();
  return useQuery({
    queryKey: ['pos', 'shift', register],
    queryFn: () => api.get<{ shift: Shift | null; summary?: ShiftSummary }>('/pos/shift/current', { register }),
    refetchInterval: 30_000,
  });
}

/** Shown when no shift is open on this register. */
export function OpenShiftCard() {
  const [register, setRegister] = useState(currentRegister());
  const [float, setFloat] = useState('200.00');
  const open = useAction(
    () => {
      try {
        localStorage.setItem(REGISTER_KEY, register);
      } catch {
        /* ignore */
      }
      return api.post('/pos/shift/open', { register, openingFloat: parseMoney(float) ?? 0 });
    },
    { success: 'Shift opened — ready to trade', invalidate: [['pos', 'shift']] },
  );
  return (
    <Card className="mx-auto mt-16 max-w-md">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"><Wallet className="size-5" /></span>
        <div>
          <h2 className="font-semibold text-ink-900">Open a shift</h2>
          <p className="text-sm text-ink-500">Count the opening float into the drawer.</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Register"><Input value={register} onChange={(e) => setRegister(e.target.value)} /></Field>
        <Field label="Opening float"><Input value={float} onChange={(e) => setFloat(e.target.value)} inputMode="decimal" /></Field>
      </div>
      <Button variant="primary" size="lg" className="mt-5 w-full" loading={open.isPending} disabled={parseMoney(float) == null || !register} onClick={() => open.mutate(undefined)}>
        Open shift
      </Button>
    </Card>
  );
}

export interface SaleDetail {
  id: string;
  number: string;
  type: string;
  createdAt: string;
  subtotal: number;
  discountTotal: number;
  surcharge: number;
  gst: number;
  total: number;
  status: string;
  cashier?: string;
  store?: { name: string; suburb: string; state: string } | null;
  customer?: { name: string; points: number } | null;
  lines: { id: string; description: string; quantity: number; unitPrice: number; discount: number; lineTotal: number; isPbs: boolean; gstFree: boolean; refundedQty: number; prescriptionId: string | null; productId: string | null }[];
  payments: { tender: string; amount: number; reference: string | null }[];
}

export function Receipt({ sale, change }: { sale: SaleDetail; change?: number }) {
  const { session } = useSession();
  return (
    <div className="mx-auto w-[72mm] bg-white p-3 font-mono text-[11px] leading-snug text-black">
      <div className="text-center">
        <div className="text-[13px] font-bold">{sale.store?.name ?? session?.tenant?.name}</div>
        <div>{sale.store ? `${sale.store.suburb} ${sale.store.state}` : ''}</div>
        <div className="mt-1">TAX INVOICE</div>
        <div>{session?.tenant?.name}</div>
      </div>
      <div className="my-2 border-t border-dashed border-black" />
      <div className="flex justify-between"><span>{sale.number}</span><span>{dateTime(sale.createdAt)}</span></div>
      {sale.cashier && <div>Served by {sale.cashier}</div>}
      <div className="my-2 border-t border-dashed border-black" />
      {sale.lines.map((l) => (
        <div key={l.id} className="mb-1">
          <div className="flex justify-between gap-2">
            <span className="truncate">{l.gstFree ? '' : '*'}{l.description}</span>
            <span>{money(l.lineTotal)}</span>
          </div>
          {(Math.abs(l.quantity) > 1 || l.discount > 0) && (
            <div className="pl-2 text-[10px]">
              {Math.abs(l.quantity)} @ {money(l.unitPrice)}{l.discount > 0 && ` less ${money(l.discount)}`}
            </div>
          )}
        </div>
      ))}
      <div className="my-2 border-t border-dashed border-black" />
      {sale.discountTotal > 0 && <div className="flex justify-between"><span>Savings</span><span>-{money(sale.discountTotal)}</span></div>}
      {sale.surcharge > 0 && <div className="flex justify-between"><span>Card surcharge</span><span>{money(sale.surcharge)}</span></div>}
      <div className="flex justify-between text-[13px] font-bold"><span>TOTAL</span><span>{money(sale.total)}</span></div>
      <div className="flex justify-between"><span>GST included</span><span>{money(sale.gst)}</span></div>
      <div className="my-2 border-t border-dashed border-black" />
      {sale.payments.map((p, i) => (
        <div key={i} className="flex justify-between"><span>{TENDER_LABELS[p.tender as TenderType] ?? p.tender}{p.reference ? ` ${p.reference}` : ''}</span><span>{money(p.amount)}</span></div>
      ))}
      {change != null && change > 0 && <div className="flex justify-between font-bold"><span>CHANGE</span><span>{money(change)}</span></div>}
      <div className="my-2 border-t border-dashed border-black" />
      <div className="text-center text-[10px]">* taxable item · PBS items are exempt from card surcharges</div>
      <div className="mt-1 text-center">Thank you</div>
    </div>
  );
}

export function ReceiptDialog({ saleId, change, onClose }: { saleId: string | null; change?: number; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ['pos', 'sale', saleId], queryFn: () => api.get<SaleDetail>(`/pos/sales/${saleId}`), enabled: !!saleId });
  return (
    <>
      <Dialog
        open={!!saleId}
        onClose={onClose}
        size="sm"
        title={change != null && change > 0 ? `Change due ${money(change)}` : 'Sale complete'}
        footer={<><Button variant="ghost" onClick={onClose}>New sale</Button><Button variant="primary" icon={<Printer className="size-4" />} onClick={() => window.print()} data-autofocus>Print receipt</Button></>}
      >
        {data ? <Receipt sale={data} change={change} /> : <Loading />}
      </Dialog>
      {saleId && data && createPortal(<div className="print-only"><Receipt sale={data} change={change} /></div>, document.body)}
    </>
  );
}
