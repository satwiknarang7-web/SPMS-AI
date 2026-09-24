'use client';

import { cardSurcharge, TENDER_LABELS, type TenderType } from '@segue/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Banknote, CreditCard, Gift, Minus, PackageCheck, Pill, Plus, ScanLine, Search, Tag, Trash2, UserRound, Wallet, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Alert, Badge, Button, Dialog, EmptyState, Field, Input, Kbd, Loading, SearchInput, Spinner, Tabs, Textarea } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { OpenShiftCard, ReceiptDialog, useCurrentShift } from '@/features/pos/shared/shift';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dollars, money, parseMoney } from '@/lib/format';
import { useHotkey } from '@/lib/hooks';

export interface CartItem {
  key: string;
  productId?: string;
  prescriptionId?: string;
  quantity: number;
  discount: number;
}

export interface PricedLine {
  key: string;
  productId: string | null;
  prescriptionId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  promoDiscount: number;
  manualDiscount: number;
  discount: number;
  lineTotal: number;
  gstFree: boolean;
  isPbs: boolean;
  promotion: { id: string; name: string } | null;
  margin: { level: string; marginPct: number; message: string | null } | null;
  onHand: number | null;
}

export interface Quote {
  lines: PricedLine[];
  totals: { subtotal: number; discountTotal: number; total: number; gst: number; pbsTotal: number; nonPbsTotal: number };
  surchargePct: number;
  belowCost: string[];
  lowMargin: string[];
}

export interface Customer { id: string; name: string; phone: string | null; loyaltyNo: string | null; points: number; hasAccount: boolean; balance: number; creditLimit: number }

export interface CatalogueProduct { id: string; name: string; barcode: string | null; sku: string; retailPrice: number; onHand: number; promotion: { name: string; price: number } | null; category: string }

export interface ReadyScript { id: string; number: string; patientPrice: number | null; scriptType: string; patient: { firstName: string; lastName: string }; drug: { brandName: string; strength: string } }

export function Register() {
  const { data: shiftData, isLoading } = useCurrentShift();
  if (isLoading) return <Loading />;
  if (!shiftData?.shift) return <OpenShiftCard />;
  return <Till shiftId={shiftData.shift.id} register={shiftData.shift.register} />;
}

export function Till({ shiftId, register }: { shiftId: string; register: string }) {
  const { can } = useSession();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [code, setCode] = useState('');
  const [panel, setPanel] = useState<'keys' | 'scripts' | 'search'>('keys');
  const [tendering, setTendering] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [receipt, setReceipt] = useState<{ id: string; change: number } | null>(null);
  const [discountFor, setDiscountFor] = useState<PricedLine | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const hotkeys = useQuery({ queryKey: ['pos', 'hotkeys'], queryFn: () => api.get<{ id: string; name: string; color: string; price: number }[]>('/pos/hotkeys') });
  const cartKey = cart.map((c) => `${c.productId ?? c.prescriptionId}:${c.quantity}:${c.discount}`).join('|');
  const quote = useQuery({
    queryKey: ['pos', 'quote', cartKey],
    queryFn: () => api.post<Quote>('/pos/quote', { lines: cart.map(({ productId, prescriptionId, quantity, discount }) => ({ productId, prescriptionId, quantity, discount })) }),
    enabled: cart.length > 0,
    placeholderData: (prev) => prev,
  });
  const q = cart.length ? quote.data : undefined;

  const addProduct = useCallback((productId: string) => {
    setCart((c) => {
      const existing = c.find((x) => x.productId === productId);
      if (existing) return c.map((x) => (x === existing ? { ...x, quantity: x.quantity + 1 } : x));
      return [...c, { key: `p-${productId}-${Date.now()}`, productId, quantity: 1, discount: 0 }];
    });
  }, []);
  const addScript = useCallback((prescriptionId: string) => {
    setCart((c) => (c.some((x) => x.prescriptionId === prescriptionId) ? c : [...c, { key: `rx-${prescriptionId}`, prescriptionId, quantity: 1, discount: 0 }]));
  }, []);

  const scan = async () => {
    const value = code.trim();
    if (!value) return;
    try {
      const hit = await api.get<{ kind: 'PRODUCT' | 'PRESCRIPTION'; productId?: string; prescriptionId?: string; status?: string }>('/pos/lookup', { code: value });
      if (hit.kind === 'PRESCRIPTION') {
        if (hit.status !== 'READY') toast.error(`That script is ${hit.status?.toLowerCase().replace(/_/g, ' ')} — it can't be sold yet`);
        else addScript(hit.prescriptionId!);
      } else addProduct(hit.productId!);
      setCode('');
    } catch {
      // Not a barcode — treat as a product search.
      setPanel('search');
    }
  };

  const clear = () => {
    setCart([]);
    setCustomer(null);
    setTimeout(() => scanRef.current?.focus(), 30);
  };

  useHotkey('F9', () => q && setTendering(true), { allowInInputs: true });
  useHotkey('F4', () => setPanel('scripts'), { allowInInputs: true });
  useHotkey('F2', () => scanRef.current?.focus(), { allowInInputs: true });

  const blocked = !!q?.belowCost.length && !can('pos.discount.override');

  return (
    <div className="flex h-full min-h-0">
      {/* Left: input & quick keys */}
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-5">
        <div className="flex items-center gap-3">
          <form className="flex-1" onSubmit={(e) => { e.preventDefault(); void scan(); }}>
            <Input ref={scanRef} autoFocus icon={<ScanLine />} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Scan a barcode or script token, or type to search…" className="[&_input]:h-12 [&_input]:text-base" suffix={<Kbd>F2</Kbd>} />
          </form>
          <Badge tone="accent" className="px-3 py-1.5 text-xs">{register}</Badge>
        </div>
        <Tabs
          value={panel}
          onChange={setPanel}
          tabs={[
            { value: 'keys', label: 'Hot keys' },
            { value: 'scripts', label: <>Ready scripts <Kbd>F4</Kbd></> },
            { value: 'search', label: 'Product search' },
          ]}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {panel === 'keys' && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {hotkeys.data?.map((h) => (
                <button key={h.id} onClick={() => addProduct(h.id)} className="group flex h-24 flex-col justify-between rounded-2xl p-3.5 text-left text-white shadow-sm transition-transform active:scale-[0.97]" style={{ background: h.color }}>
                  <span className="line-clamp-2 text-sm leading-snug font-semibold">{h.name}</span>
                  <span className="text-lg font-bold tnum">{money(h.price)}</span>
                </button>
              ))}
            </div>
          )}
          {panel === 'scripts' && <ReadyScripts onPick={addScript} inCart={cart.map((c) => c.prescriptionId).filter(Boolean) as string[]} />}
          {panel === 'search' && <ProductSearch initial={code} onPick={(id) => { addProduct(id); setCode(''); }} />}
        </div>
      </div>

      {/* Right: cart */}
      <div className="flex w-[440px] shrink-0 flex-col border-l border-ink-200 bg-white">
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
          <button onClick={() => setCustomerOpen(true)} className="flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-ink-50">
            <span className="grid size-8 place-items-center rounded-full bg-ink-100 text-ink-500"><UserRound className="size-4" /></span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink-900">{customer?.name ?? 'Walk-in customer'}</span>
              <span className="block text-xs text-ink-500">{customer ? `${customer.points} points${customer.hasAccount ? ` · account ${money(customer.balance)}` : ''}` : 'Add loyalty or account customer'}</span>
            </span>
          </button>
          {cart.length > 0 && <Button size="sm" variant="ghost" onClick={clear} icon={<X className="size-4" />}>Clear</Button>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <EmptyState icon={<ScanLine />} title="Ready for the next customer" description="Scan items or pull a ready script from the dispensary." />
          ) : !q ? (
            <div className="p-6"><Spinner /></div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {q.lines.map((l, i) => {
                const item = cart[i];
                if (!item) return null;
                const warn = q.belowCost.includes(l.key) ? 'red' : q.lowMargin.includes(l.key) ? 'amber' : null;
                return (
                  <li key={item.key} className="px-5 py-3">
                    <div className="flex items-start gap-3">
                      <span className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg', l.prescriptionId ? 'bg-sky-50 text-sky-600' : 'bg-ink-100 text-ink-500')}>
                        {l.prescriptionId ? <Pill className="size-3.5" /> : <Tag className="size-3.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm leading-snug font-medium text-ink-900">{l.description}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                          <span className="tnum">{money(l.unitPrice)}</span>
                          {l.isPbs && <Badge tone="blue">PBS</Badge>}
                          {l.promotion && <Badge tone="violet">{l.promotion.name}</Badge>}
                          {l.manualDiscount > 0 && <Badge tone="neutral">−{money(l.manualDiscount)}</Badge>}
                          {l.onHand != null && l.onHand <= 0 && <Badge tone="amber">Stock {l.onHand}</Badge>}
                        </div>
                        {warn && l.margin?.message && (
                          <div className={cn('mt-1.5 flex items-center gap-1 text-xs font-medium', warn === 'red' ? 'text-rose-600' : 'text-amber-700')}>
                            <AlertTriangle className="size-3.5" /> {l.margin.message}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-ink-900 tnum">{money(l.lineTotal)}</div>
                        {l.discount > 0 && <div className="text-xs text-ink-400 line-through tnum">{money(l.unitPrice * l.quantity)}</div>}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-1 pl-10">
                      {!l.prescriptionId && (
                        <>
                          <Button size="xs" variant="secondary" onClick={() => setCart((c) => c.map((x) => (x.key === item.key ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x)))} aria-label="Decrease"><Minus className="size-3" /></Button>
                          <span className="w-8 text-center text-sm font-medium tnum">{item.quantity}</span>
                          <Button size="xs" variant="secondary" onClick={() => setCart((c) => c.map((x) => (x.key === item.key ? { ...x, quantity: x.quantity + 1 } : x)))} aria-label="Increase"><Plus className="size-3" /></Button>
                          <Button size="xs" variant="ghost" className="ml-1" onClick={() => setDiscountFor(l)}>Discount</Button>
                        </>
                      )}
                      <Button size="xs" variant="ghost" className="ml-auto text-rose-600" onClick={() => setCart((c) => c.filter((x) => x.key !== item.key))} aria-label="Remove"><Trash2 className="size-3.5" /></Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-ink-200 bg-ink-50/60 px-5 py-4">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between text-ink-500"><dt>Subtotal</dt><dd className="tnum">{money(q?.totals.subtotal ?? 0)}</dd></div>
            {(q?.totals.discountTotal ?? 0) > 0 && <div className="flex justify-between text-emerald-700"><dt>Savings</dt><dd className="tnum">−{money(q!.totals.discountTotal)}</dd></div>}
            <div className="flex justify-between text-ink-500"><dt>GST included</dt><dd className="tnum">{money(q?.totals.gst ?? 0)}</dd></div>
            {(q?.totals.pbsTotal ?? 0) > 0 && <div className="flex justify-between text-ink-500"><dt>PBS items (no surcharge)</dt><dd className="tnum">{money(q!.totals.pbsTotal)}</dd></div>}
          </dl>
          <div className="mt-3 flex items-end justify-between">
            <span className="text-sm font-medium text-ink-600">Total</span>
            <span className="text-3xl font-bold tracking-tight text-ink-900 tnum">{money(q?.totals.total ?? 0)}</span>
          </div>
          {blocked && <Alert tone="red" className="mt-3" title="Manager override needed">A discount takes an item below cost.</Alert>}
          <Button variant="primary" size="xl" className="mt-4 w-full" disabled={!q || cart.length === 0 || blocked || quote.isFetching} onClick={() => setTendering(true)}>
            Pay <Kbd>F9</Kbd>
          </Button>
        </div>
      </div>

      {q && tendering && (
        <TenderDialog
          quote={q}
          customer={customer}
          shiftId={shiftId}
          cart={cart}
          onClose={() => setTendering(false)}
          onDone={(id, change) => {
            setTendering(false);
            setReceipt({ id, change });
            clear();
          }}
        />
      )}
      <CustomerDialog open={customerOpen} onClose={() => setCustomerOpen(false)} onPick={(c) => { setCustomer(c); setCustomerOpen(false); }} />
      <DiscountDialog
        line={discountFor}
        onClose={() => setDiscountFor(null)}
        onApply={(cents) => {
          const line = discountFor;
          if (!line) return;
          setCart((c) => c.map((x) => (x.productId === line.productId ? { ...x, discount: cents } : x)));
          setDiscountFor(null);
        }}
      />
      <ReceiptDialog saleId={receipt?.id ?? null} change={receipt?.change} onClose={() => setReceipt(null)} />
    </div>
  );
}

export function ReadyScripts({ onPick, inCart }: { onPick: (id: string) => void; inCart: string[] }) {
  const [q, setQ] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['pos', 'ready', q], queryFn: () => api.get<ReadyScript[]>('/pos/scripts/ready', { q }), refetchInterval: 15_000 });
  return (
    <div>
      <SearchInput value={q} onChange={setQ} placeholder="Patient name or script number" className="mb-3 max-w-sm" />
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState icon={<PackageCheck />} title="No scripts waiting" description="Scripts appear here once the pharmacist completes the final check." />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {data.map((s) => {
            const added = inCart.includes(s.id);
            return (
              <button key={s.id} disabled={added} onClick={() => onPick(s.id)} className={cn('flex items-center gap-3 rounded-xl bg-white p-3 text-left ring-1 ring-ink-200 hover:ring-[var(--accent)]', added && 'opacity-50')}>
                <span className="grid size-10 place-items-center rounded-xl bg-sky-50 text-sky-600"><Pill className="size-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink-900">{s.patient.lastName.toUpperCase()}, {s.patient.firstName}</span>
                  <span className="block truncate text-xs text-ink-500">{s.drug.brandName} {s.drug.strength} · {s.number}</span>
                </span>
                <span className="text-right">
                  <span className="block font-semibold text-ink-900 tnum">{money(s.patientPrice)}</span>
                  <Badge tone="blue">{s.scriptType}</Badge>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ProductSearch({ initial, onPick }: { initial: string; onPick: (id: string) => void }) {
  const [q, setQ] = useState(initial);
  const { data, isFetching } = useQuery({ queryKey: ['catalogue', q], queryFn: () => api.get<CatalogueProduct[]>('/platform/catalogue/products', { q, take: 40 }), enabled: q.length >= 2 });
  return (
    <div>
      <SearchInput value={q} onChange={setQ} placeholder="Product name, brand, SKU or barcode" className="mb-3 max-w-md" autoFocus />
      {isFetching && !data && <Spinner />}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {data?.filter((p) => p.category !== 'Prescription').map((p) => (
          <button key={p.id} onClick={() => onPick(p.id)} className="rounded-xl bg-white p-3 text-left ring-1 ring-ink-200 hover:ring-[var(--accent)]">
            <div className="line-clamp-2 text-sm font-medium text-ink-900">{p.name}</div>
            <div className="mt-1.5 flex items-center justify-between text-xs">
              <span className="text-ink-500">{p.onHand} in stock</span>
              <span className="text-right">
                {p.promotion ? (
                  <><span className="mr-1 text-ink-400 line-through">{money(p.retailPrice)}</span><span className="font-semibold text-violet-700">{money(p.promotion.price)}</span></>
                ) : (
                  <span className="font-semibold text-ink-900">{money(p.retailPrice)}</span>
                )}
              </span>
            </div>
          </button>
        ))}
      </div>
      {q.length < 2 && <p className="text-sm text-ink-500"><Search className="mr-1 inline size-4" />Type at least two characters.</p>}
    </div>
  );
}

export const TENDER_ICONS: Record<TenderType, typeof Banknote> = { CASH: Banknote, EFTPOS: CreditCard, ACCOUNT: Wallet, GIFT_VOUCHER: Gift, STORE_CREDIT: Gift };

export function TenderDialog({ quote, customer, shiftId, cart, onClose, onDone }: { quote: Quote; customer: Customer | null; shiftId: string; cart: CartItem[]; onClose: () => void; onDone: (saleId: string, change: number) => void }) {
  const { can } = useSession();
  const [tenders, setTenders] = useState<{ type: TenderType; amount: number; reference?: string }[]>([]);
  const [amount, setAmount] = useState(dollars(quote.totals.total));
  const [email, setEmail] = useState('');
  const [override, setOverride] = useState('');
  const [busy, setBusy] = useState(false);

  const total = quote.totals.total;
  const paid = tenders.reduce((s, t) => s + t.amount, 0);
  const remaining = Math.max(0, total - paid);
  const card = tenders.filter((t) => t.type === 'EFTPOS').reduce((s, t) => s + t.amount, 0);
  const surcharge = cardSurcharge(card, quote.totals.nonPbsTotal, quote.surchargePct);
  const change = Math.max(0, paid - total);
  const needsOverride = quote.belowCost.length > 0;

  useEffect(() => setAmount(dollars(remaining)), [remaining]);

  const add = (type: TenderType, value?: number) => {
    const cents = value ?? parseMoney(amount);
    if (!cents || cents <= 0) return toast.error('Enter an amount');
    if (type !== 'CASH' && cents > remaining) return toast.error('Only cash can be over-tendered');
    if (type === 'ACCOUNT' && !customer?.hasAccount) return toast.error('Attach an account customer first');
    setTenders((t) => [...t, { type, amount: cents }]);
  };

  const complete = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ sale: { id: string }; change: number }>('/pos/sales', {
        shiftId, customerId: customer?.id, receiptEmail: email || null, overrideReason: needsOverride ? override : null, tenders,
        lines: cart.map(({ productId, prescriptionId, quantity, discount }) => ({ productId, prescriptionId, quantity, discount })),
      });
      onDone(res.sale.id, res.change);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const cashQuick = useMemo(() => {
    const opts = [remaining, Math.ceil(remaining / 500) * 500, Math.ceil(remaining / 1000) * 1000, Math.ceil(remaining / 2000) * 2000, Math.ceil(remaining / 5000) * 5000, 10000];
    return [...new Set(opts)].filter((x) => x >= remaining && x > 0).slice(0, 5);
  }, [remaining]);

  return (
    <Dialog open onClose={onClose} size="lg" title="Take payment" description={`${quote.lines.length} item(s)${customer ? ` · ${customer.name}` : ''}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Back to sale</Button>
          <Button variant="primary" size="lg" disabled={remaining > 0 || (needsOverride && override.trim().length < 3)} loading={busy} onClick={() => void complete()}>
            Complete sale
          </Button>
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-[1fr_260px]">
        <div>
          <div className="rounded-2xl bg-ink-950 p-5 text-white">
            <div className="text-sm text-ink-400">{remaining > 0 ? 'Remaining' : change > 0 ? 'Change due' : 'Paid in full'}</div>
            <div className="text-4xl font-bold tracking-tight tnum">{money(remaining > 0 ? remaining : change)}</div>
            <div className="mt-2 text-xs text-ink-400">Goods total {money(total)}{surcharge > 0 && ` · card surcharge ${money(surcharge)} (${quote.surchargePct}% on non-PBS card portion)`}</div>
          </div>
          <Field label="Amount" className="mt-4">
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="[&_input]:h-12 [&_input]:text-lg" />
          </Field>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(['CASH', 'EFTPOS', 'ACCOUNT', 'GIFT_VOUCHER', 'STORE_CREDIT'] as TenderType[]).map((t) => {
              const Icon = TENDER_ICONS[t];
              return (
                <Button key={t} size="lg" variant={t === 'EFTPOS' ? 'primary' : 'secondary'} icon={<Icon className="size-4" />} disabled={remaining === 0 || (t === 'ACCOUNT' && !customer?.hasAccount)} onClick={() => add(t)}>
                  {TENDER_LABELS[t]}
                </Button>
              );
            })}
          </div>
          {remaining > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {cashQuick.map((c) => (
                <Button key={c} size="sm" variant="accent-soft" onClick={() => add('CASH', c)}>Cash {money(c)}</Button>
              ))}
            </div>
          )}
          {needsOverride && (
            <Field label="Below-cost override reason" className="mt-4" required hint={can('pos.discount.override') ? 'Recorded against your name in the audit log.' : undefined}>
              <Textarea className="min-h-12" value={override} onChange={(e) => setOverride(e.target.value)} />
            </Field>
          )}
        </div>
        <div>
          <div className="text-[13px] font-semibold text-ink-700">Tenders</div>
          <ul className="mt-2 space-y-1.5">
            {tenders.length === 0 && <li className="text-sm text-ink-500">None yet — split across as many as needed.</li>}
            {tenders.map((t, i) => (
              <li key={i} className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2 text-sm">
                <span>{TENDER_LABELS[t.type]}</span>
                <span className="flex items-center gap-2 font-semibold tnum">
                  {money(t.amount)}
                  <button onClick={() => setTenders((x) => x.filter((_, j) => j !== i))} className="text-ink-400 hover:text-rose-600" aria-label="Remove"><X className="size-3.5" /></button>
                </span>
              </li>
            ))}
          </ul>
          <Field label="Email receipt to" className="mt-5">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" />
          </Field>
          <p className="mt-4 text-xs text-ink-500">EFTPOS runs through the integrated terminal. Card data never touches Segue — only a tokenised reference is stored.</p>
        </div>
      </div>
    </Dialog>
  );
}

export function CustomerDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (c: Customer | null) => void }) {
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  const { data } = useQuery({ queryKey: ['pos', 'customers', q], queryFn: () => api.get<Customer[]>('/pos/customers', { q }), enabled: open });
  const create = async () => {
    try {
      const c = await api.post<Customer>('/pos/customers', form);
      toast.success('Customer enrolled in loyalty');
      onPick(c);
      setCreating(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Customer" description="Attach a loyalty member or an account customer to this sale.">
      {creating ? (
        <div className="grid gap-3">
          <Field label="Name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Mobile"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Email"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setCreating(false)}>Back</Button><Button variant="primary" onClick={() => void create()} disabled={form.name.length < 2}>Enrol</Button></div>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <SearchInput value={q} onChange={setQ} placeholder="Name, mobile or loyalty number" className="flex-1" />
            <Button onClick={() => setCreating(true)}>New</Button>
          </div>
          <ul className="mt-3 max-h-80 divide-y divide-ink-100 overflow-y-auto rounded-xl ring-1 ring-ink-200">
            <li><button onClick={() => onPick(null)} className="w-full px-4 py-2.5 text-left text-sm text-ink-500 hover:bg-ink-50">Walk-in customer</button></li>
            {data?.map((c) => (
              <li key={c.id}>
                <button onClick={() => onPick(c)} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-ink-50">
                  <span><span className="font-medium text-ink-900">{c.name}</span><span className="block text-xs text-ink-500">{c.phone} · {c.loyaltyNo}</span></span>
                  <span className="flex gap-1.5">{c.hasAccount && <Badge tone="violet">Account</Badge>}<Badge>{c.points} pts</Badge></span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}

export function DiscountDialog({ line, onClose, onApply }: { line: PricedLine | null; onClose: () => void; onApply: (cents: number) => void }) {
  const [mode, setMode] = useState<'pct' | 'amt'>('pct');
  const [value, setValue] = useState('');
  useEffect(() => {
    if (line) {
      setValue('');
      setMode('pct');
    }
  }, [line]);
  if (!line) return null;
  const gross = line.unitPrice * line.quantity - line.promoDiscount;
  const cents = mode === 'pct' ? Math.round((gross * (Number.parseFloat(value) || 0)) / 100) : parseMoney(value) ?? 0;
  const net = gross - cents;
  const unitNet = net / line.quantity;
  const belowCost = unitNet < line.unitCost;
  return (
    <Dialog open onClose={onClose} size="sm" title="Line discount" description={line.description}
      footer={<><Button variant="ghost" onClick={() => onApply(0)}>Remove discount</Button><Button variant="primary" onClick={() => onApply(Math.min(cents, gross))}>Apply</Button></>}>
      <Tabs value={mode} onChange={setMode} tabs={[{ value: 'pct', label: 'Percent' }, { value: 'amt', label: 'Amount' }]} />
      <Input className="mt-3" value={value} onChange={(e) => setValue(e.target.value)} placeholder={mode === 'pct' ? 'e.g. 10' : 'e.g. 2.00'} inputMode="decimal" autoFocus />
      <div className="mt-3 flex justify-between text-sm"><span className="text-ink-500">New line total</span><span className="font-semibold tnum">{money(Math.max(0, net))}</span></div>
      {belowCost && <Alert tone="red" className="mt-3">This takes the item below cost ({money(line.unitCost)} each). A manager override will be required.</Alert>}
    </Dialog>
  );
}
