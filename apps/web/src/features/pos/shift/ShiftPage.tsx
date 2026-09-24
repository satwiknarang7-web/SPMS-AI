'use client';

import { TENDER_LABELS, type TenderType } from '@segue/shared';
import { ArrowDownCircle, ArrowUpCircle, DoorOpen, FileBarChart, Lock, Printer } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { PageBody } from '@/components/layout/AppShell';
import { Alert, Button, Card, CardHeader, Dialog, Field, Input, Loading, PageHeader, Stat, Table, TD, TH, THead, TR } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { OpenShiftCard, type Shift, type ShiftSummary, useCurrentShift } from '@/features/pos/shared/shift';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { date, dateTime, daysAgoISO, money, parseMoney, todayISO } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface ReportDoc { type: 'X' | 'Z' | 'ZZ'; shift?: Shift; summary: ShiftSummary; expectedCash?: number; countedCash?: number; variance?: number; generatedAt: string; from?: string; to?: string; totalVariance?: number; shifts?: (Shift & { closedAt: string | null; expectedCash: number | null; countedCash: number | null })[] }

export function ShiftPage() {
  const { can, store } = useSession();
  const { data, isLoading } = useCurrentShift();
  const [event, setEvent] = useState<null | 'PAID_IN' | 'PAID_OUT' | 'NO_SALE'>(null);
  const [closing, setClosing] = useState(false);
  const [report, setReport] = useState<ReportDoc | null>(null);
  const [zzFrom, setZzFrom] = useState(daysAgoISO(7));
  const [zzTo, setZzTo] = useState(todayISO());
  const [zzBusy, setZzBusy] = useState(false);

  if (isLoading) return <Loading />;
  const shift = data?.shift;
  const s = data?.summary;

  const xReport = async () => setReport(await api.get<ReportDoc>(`/pos/shift/${shift!.id}/x-report`));
  const zzReport = async () => {
    setZzBusy(true);
    try {
      setReport(await api.get<ReportDoc>('/pos/reports/zz', { from: zzFrom, to: zzTo }));
    } finally {
      setZzBusy(false);
    }
  };

  return (
    <PageBody>
      <PageHeader
        title="Cash & balancing"
        subtitle={shift ? `${shift.register} · opened ${dateTime(shift.openedAt)} with ${money(shift.openingFloat)} float` : store?.name}
        actions={shift && (
          <>
            <Button icon={<ArrowDownCircle className="size-4" />} onClick={() => setEvent('PAID_IN')}>Paid in</Button>
            <Button icon={<ArrowUpCircle className="size-4" />} onClick={() => setEvent('PAID_OUT')}>Paid out</Button>
            <Button icon={<DoorOpen className="size-4" />} onClick={() => setEvent('NO_SALE')}>No sale</Button>
            <Button icon={<FileBarChart className="size-4" />} onClick={() => void xReport()}>X-Report</Button>
            {can('pos.shift.manage') && <Button variant="primary" icon={<Lock className="size-4" />} onClick={() => setClosing(true)}>Close shift (Z)</Button>}
          </>
        )}
      />
      {!shift || !s ? (
        <OpenShiftCard />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Sales this shift" value={money(s.grossSales)} hint={`${s.salesCount} transactions`} />
            <Stat label="Refunds" value={money(s.refunds)} hint={`${s.refundCount} returns`} tone="red" />
            <Stat label="Scripts collected" value={s.scriptsCollected} tone="green" />
            <Stat label="Card surcharges" value={money(s.surcharge)} hint="PBS items exempt" />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Takings by tender" />
              <ul className="space-y-2 text-sm">
                {Object.entries(s.byTender).map(([t, v]) => (
                  <li key={t} className="flex justify-between"><span className="text-ink-600">{TENDER_LABELS[t as TenderType] ?? t}</span><span className="font-semibold tnum">{money(v)}</span></li>
                ))}
              </ul>
            </Card>
            <Card>
              <CardHeader title="Cash drawer" subtitle="What should be in the drawer right now" />
              <CashLines float={shift.openingFloat} s={s} />
            </Card>
          </div>
          <Card>
            <CardHeader title="ZZ-Report" subtitle="Period audit across every register in this store" />
            <div className="flex flex-wrap items-end gap-3">
              <Field label="From"><Input type="date" value={zzFrom} onChange={(e) => setZzFrom(e.target.value)} /></Field>
              <Field label="To"><Input type="date" value={zzTo} onChange={(e) => setZzTo(e.target.value)} /></Field>
              <Button onClick={() => void zzReport()} loading={zzBusy} disabled={!can('pos.shift.manage')}>Run ZZ-Report</Button>
            </div>
            {!can('pos.shift.manage') && <p className="mt-2 text-xs text-ink-500">Period reports require a manager.</p>}
          </Card>
        </div>
      )}
      {shift && <CashEventDialog type={event} shiftId={shift.id} onClose={() => setEvent(null)} />}
      {shift && s && <CloseDialog open={closing} shift={shift} summary={s} onClose={() => setClosing(false)} onClosed={(r) => { setClosing(false); setReport(r); }} />}
      <ReportDialog report={report} onClose={() => setReport(null)} />
    </PageBody>
  );
}

export function expected(float: number, s: ShiftSummary) {
  return float + s.cashSales - s.cashRefunds + s.paidIn + s.otherCashIn - s.paidOut;
}

export function CashLines({ float, s }: { float: number; s: ShiftSummary }) {
  const rows: [string, number][] = [['Opening float', float], ['Cash sales', s.cashSales], ['Cash refunds', -s.cashRefunds], ['Paid in', s.paidIn], ['Layby & hire', s.otherCashIn], ['Paid out', -s.paidOut]];
  return (
    <dl className="space-y-1.5 text-sm">
      {rows.map(([l, v]) => (
        <div key={l} className="flex justify-between"><dt className="text-ink-500">{l}</dt><dd className={cn('tnum', v < 0 && 'text-rose-600')}>{money(v)}</dd></div>
      ))}
      <div className="flex justify-between border-t border-ink-200 pt-2 text-base font-bold"><dt>Expected cash</dt><dd className="tnum">{money(expected(float, s))}</dd></div>
      <div className="flex justify-between text-xs text-ink-500"><dt>No-sale drawer openings</dt><dd>{s.noSales}</dd></div>
    </dl>
  );
}

export function CashEventDialog({ type, shiftId, onClose }: { type: null | 'PAID_IN' | 'PAID_OUT' | 'NO_SALE'; shiftId: string; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const save = useAction(() => api.post(`/pos/shift/${shiftId}/cash-event`, { type, amount: type === 'NO_SALE' ? 0 : parseMoney(amount) ?? 0, reason }), {
    success: 'Recorded', invalidate: [['pos', 'shift']], onSuccess: () => { setAmount(''); setReason(''); onClose(); },
  });
  const title = { PAID_IN: 'Paid in', PAID_OUT: 'Paid out (petty cash)', NO_SALE: 'No sale — open drawer' }[type ?? 'NO_SALE'];
  return (
    <Dialog open={!!type} onClose={onClose} size="sm" title={title} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={reason.length < 2 || (type !== 'NO_SALE' && !parseMoney(amount))} onClick={() => save.mutate(undefined)}>Record</Button></>}>
      <div className="grid gap-3">
        {type !== 'NO_SALE' && <Field label="Amount"><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></Field>}
        <Field label="Reason" required><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={type === 'PAID_OUT' ? 'e.g. Milk and cleaning supplies' : 'e.g. Change for customer'} /></Field>
      </div>
    </Dialog>
  );
}

export function CloseDialog({ open, shift, summary, onClose, onClosed }: { open: boolean; shift: Shift; summary: ShiftSummary; onClose: () => void; onClosed: (r: ReportDoc) => void }) {
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const exp = expected(shift.openingFloat, summary);
  const c = parseMoney(counted);
  const close = useAction(() => api.post<ReportDoc>(`/pos/shift/${shift.id}/close`, { countedCash: c ?? 0, notes }), { success: 'Shift closed', invalidate: [['pos']], onSuccess: onClosed });
  return (
    <Dialog open={open} onClose={onClose} title="Close shift — Z-Report" description="Count the drawer. The variance is recorded against this shift."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={c == null} loading={close.isPending} onClick={() => close.mutate(undefined)}>Close shift</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Counted cash"><Input value={counted} onChange={(e) => setCounted(e.target.value)} inputMode="decimal" autoFocus /></Field>
        <div className="rounded-xl bg-ink-50 p-3 text-sm">
          <div className="flex justify-between"><span className="text-ink-500">Expected</span><span className="font-semibold tnum">{money(exp)}</span></div>
          {c != null && <div className={cn('mt-1 flex justify-between font-semibold', c - exp === 0 ? 'text-emerald-700' : 'text-rose-600')}><span>Variance</span><span className="tnum">{money(c - exp)}</span></div>}
        </div>
      </div>
      <Field label="Notes" className="mt-4"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Dialog>
  );
}

export function ReportBody({ r }: { r: ReportDoc }) {
  const title = { X: 'X-Report · mid-shift snapshot', Z: 'Z-Report · end-of-day closure', ZZ: 'ZZ-Report · period audit' }[r.type];
  return (
    <div className="text-sm">
      <div className="mb-3">
        <div className="text-base font-bold text-ink-900">{title}</div>
        <div className="text-xs text-ink-500">{r.shift ? `${r.shift.register} · opened ${dateTime(r.shift.openedAt)}` : `${date(r.from)} – ${date(r.to)}`} · generated {dateTime(r.generatedAt)}</div>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5">
        {[
          ['Transactions', r.summary.salesCount], ['Gross sales', money(r.summary.grossSales)], ['Returns', `${r.summary.refundCount} · ${money(r.summary.refunds)}`], ['Discounts', money(r.summary.discounts)],
          ['GST collected', money(r.summary.gst)], ['Card surcharges', money(r.summary.surcharge)], ['Scripts collected', r.summary.scriptsCollected], ['No-sale openings', r.summary.noSales],
        ].map(([k, v]) => (
          <div key={String(k)} className="flex justify-between border-b border-ink-100 py-1"><dt className="text-ink-500">{k}</dt><dd className="font-medium tnum">{v}</dd></div>
        ))}
      </dl>
      <div className="mt-4 font-semibold text-ink-800">Tenders</div>
      <dl className="mt-1 space-y-1">
        {Object.entries(r.summary.byTender).map(([t, v]) => (
          <div key={t} className="flex justify-between"><dt className="text-ink-500">{TENDER_LABELS[t as TenderType] ?? t}</dt><dd className="tnum">{money(v)}</dd></div>
        ))}
      </dl>
      {r.expectedCash != null && (
        <div className="mt-4 rounded-xl bg-ink-50 p-3">
          <div className="flex justify-between"><span>Expected cash</span><span className="font-semibold tnum">{money(r.expectedCash)}</span></div>
          {r.countedCash != null && <div className="flex justify-between"><span>Counted</span><span className="tnum">{money(r.countedCash)}</span></div>}
          {r.variance != null && <div className={cn('flex justify-between font-bold', r.variance === 0 ? 'text-emerald-700' : 'text-rose-600')}><span>Variance</span><span className="tnum">{money(r.variance)}</span></div>}
        </div>
      )}
      {r.shifts && (
        <>
          <div className="mt-4 font-semibold text-ink-800">Shifts ({r.shifts.length}) · total variance {money(r.totalVariance ?? 0)}</div>
          <Table className="mt-2">
            <THead><tr><TH>Register</TH><TH>Opened</TH><TH align="right">Expected</TH><TH align="right">Counted</TH><TH align="right">Variance</TH></tr></THead>
            <tbody>
              {r.shifts.map((x) => (
                <TR key={x.id}>
                  <TD>{x.register}</TD><TD>{dateTime(x.openedAt)}</TD><TD align="right">{money(x.expectedCash)}</TD><TD align="right">{money(x.countedCash)}</TD>
                  <TD align="right" className={cn(x.countedCash != null && x.expectedCash != null && x.countedCash !== x.expectedCash && 'text-rose-600')}>{x.countedCash != null && x.expectedCash != null ? money(x.countedCash - x.expectedCash) : 'Open'}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </div>
  );
}

export function ReportDialog({ report, onClose }: { report: ReportDoc | null; onClose: () => void }) {
  return (
    <>
      <Dialog open={!!report} onClose={onClose} size="lg" title="Register report" footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" icon={<Printer className="size-4" />} onClick={() => window.print()}>Print</Button></>}>
        {report && (report.type === 'Z' ? <><Alert tone="green" className="mb-4">Shift closed. Keep this Z-Report with the day's banking.</Alert><ReportBody r={report} /></> : <ReportBody r={report} />)}
      </Dialog>
      {report && createPortal(<div className="print-only p-6"><ReportBody r={report} /></div>, document.body)}
    </>
  );
}
