'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Download, FileText, Mail, Play, Printer, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { PageBody } from '@/components/layout/AppShell';
import { Button, Card, CardHeader, Dialog, EmptyState, Field, Input, Loading, PageHeader, Select, Table, TD, TH, THead, TR } from '@/components/ui';
import { TrendChart } from '@/components/ui/charts';
import { useGroups } from '@/features/hq/shared/groups';
import { useCategories } from '@/features/shared/catalogue';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dateTime, daysAgoISO, money, num, pct, relative, todayISO } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface ReportColumn { key: string; label: string; type: 'text' | 'money' | 'number' | 'pct' }

export interface Report { template: string; title: string; from: string; to: string; columns: ReportColumn[]; rows: Record<string, string | number | null>[]; totals: Record<string, string | number | null>; series: { date: string; value: number }[]; seriesLabel: string }

export const fmtCell = (c: ReportColumn, v: string | number | null | undefined) => (v == null || v === '' ? '—' : c.type === 'money' ? money(Number(v)) : c.type === 'pct' ? pct(Number(v)) : c.type === 'number' ? num(Number(v)) : String(v));

export function HqReports() {
  const groups = useGroups();
  const cats = useCategories();
  const templates = useQuery({ queryKey: ['hq', 'templates'], queryFn: () => api.get<{ key: string; title: string; description: string }[]>('/hq/reports/templates') });
  const [template, setTemplate] = useState('sales-performance');
  const [filters, setFilters] = useState({ from: daysAgoISO(29), to: todayISO(), groupId: '', category: '' });
  const [scheduling, setScheduling] = useState(false);
  const [printing, setPrinting] = useState(false);
  const report = useQuery({ queryKey: ['hq', 'report', template, filters], queryFn: () => api.get<Report>(`/hq/reports/run/${template}`, filters) });
  const schedules = useQuery({ queryKey: ['hq', 'schedules'], queryFn: () => api.get<{ id: string; template: string; cadence: string; recipients: string; nextRunAt: string; lastRunAt: string | null }[]>('/hq/reports/schedules') });
  const outbox = useQuery({ queryKey: ['hq', 'outbox'], queryFn: () => api.get<{ id: string; to: string; subject: string; attachmentName: string | null; createdAt: string }[]>('/hq/reports/outbox') });
  const delSchedule = useAction((id: string) => api.delete(`/hq/reports/schedules/${id}`), { success: 'Schedule removed', invalidate: [['hq', 'schedules']] });
  const runSchedule = useAction((id: string) => api.post(`/hq/reports/schedules/${id}/run`), { success: 'Report sent to the email outbox', invalidate: [['hq', 'schedules'], ['hq', 'outbox']] });
  useEffect(() => {
    if (!printing) return;
    const t = setTimeout(() => { window.print(); setPrinting(false); }, 80);
    return () => clearTimeout(t);
  }, [printing]);
  const r = report.data;
  const table = r && (
    <Table>
      <THead><tr>{r.columns.map((c) => <TH key={c.key} align={c.type === 'text' ? undefined : 'right'}>{c.label}</TH>)}</tr></THead>
      <tbody>
        {r.rows.map((row, i) => <TR key={i}>{r.columns.map((c) => <TD key={c.key} align={c.type === 'text' ? undefined : 'right'} className={c.type === 'text' && c.key === r.columns[0]?.key ? 'font-medium text-ink-900' : ''}>{fmtCell(c, row[c.key])}</TD>)}</TR>)}
        <TR className="bg-ink-50 font-semibold">{r.columns.map((c) => <TD key={c.key} align={c.type === 'text' ? undefined : 'right'} className="font-semibold text-ink-900">{fmtCell(c, r.totals[c.key])}</TD>)}</TR>
      </tbody>
    </Table>
  );
  return (
    <PageBody wide>
      <PageHeader title="Group reports" subtitle="Consolidated, de-identified reporting across every enrolled store"
        actions={r && <>
          <a href={api.url(`/hq/reports/run/${template}`, { ...filters, format: 'csv' })}><Button icon={<Download className="size-4" />}>CSV</Button></a>
          <Button icon={<Printer className="size-4" />} onClick={() => setPrinting(true)}>PDF</Button>
          <Button variant="primary" icon={<Mail className="size-4" />} onClick={() => setScheduling(true)}>Schedule</Button>
        </>} />
      <div className="mb-5 grid gap-3 md:grid-cols-4">
        {templates.data?.map((t) => (
          <button key={t.key} onClick={() => setTemplate(t.key)} className={cn('rounded-2xl p-4 text-left ring-1 transition-colors', template === t.key ? 'bg-[var(--accent-soft)] ring-[var(--accent)]' : 'bg-white ring-ink-200 hover:ring-ink-300')}>
            <FileText className="mb-2 size-5 text-[var(--accent)]" />
            <div className="font-semibold text-ink-900">{t.title}</div>
            <div className="mt-0.5 text-xs text-ink-500">{t.description}</div>
          </button>
        ))}
      </div>
      <Card className="mb-5">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From"><Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></Field>
          <Field label="To"><Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></Field>
          <Field label="Store group"><Select value={filters.groupId} onChange={(e) => setFilters({ ...filters, groupId: e.target.value })} className="w-52"><option value="">All stores</option>{groups.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></Field>
          <Field label="Product category"><Select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} className="w-52"><option value="">All categories</option>{cats.data?.filter((c) => c.category !== 'Prescription').map((c) => <option key={c.category} value={c.category}>{c.category}</option>)}</Select></Field>
        </div>
      </Card>
      {report.isLoading || !r ? <Loading /> : (
        <div className="space-y-5">
          {r.series.length > 1 && <Card><CardHeader title={r.seriesLabel} subtitle={`${r.from} → ${r.to}`} /><TrendChart data={r.series} height={220} series={[{ key: 'value', label: r.seriesLabel, color: 'var(--accent)' }]} /></Card>}
          <Card padded={false}><div className="p-5 pb-0"><CardHeader title={r.title} /></div>{table}</Card>
        </div>
      )}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card padded={false}>
          <div className="p-5 pb-0"><CardHeader title="Scheduled delivery" icon={<CalendarClock />} /></div>
          {!schedules.data?.length ? <EmptyState title="No scheduled reports" /> : (
            <Table>
              <THead><tr><TH>Report</TH><TH>Cadence</TH><TH>Recipients</TH><TH>Next run</TH><TH /></tr></THead>
              <tbody>{schedules.data.map((s) => <TR key={s.id}><TD>{s.template}</TD><TD>{s.cadence.toLowerCase()}</TD><TD className="max-w-48 truncate text-ink-500">{s.recipients}</TD><TD className="text-ink-500">{dateTime(s.nextRunAt)}</TD><TD align="right"><div className="flex justify-end gap-1"><Button size="xs" icon={<Play className="size-3" />} onClick={() => runSchedule.mutate(s.id)}>Send now</Button><Button size="xs" variant="ghost" onClick={() => delSchedule.mutate(s.id)}><Trash2 className="size-3.5" /></Button></div></TD></TR>)}</tbody>
            </Table>
          )}
        </Card>
        <Card padded={false}>
          <div className="p-5 pb-0"><CardHeader title="Email outbox" subtitle="What the email adapter has sent (development outbox)" icon={<Mail />} /></div>
          {!outbox.data?.length ? <EmptyState title="Nothing sent yet" /> : (
            <ul className="divide-y divide-ink-100 px-5 pb-4 text-sm">{outbox.data.map((m) => <li key={m.id} className="py-2"><div className="font-medium text-ink-800">{m.subject}</div><div className="text-xs text-ink-500">to {m.to} · {m.attachmentName} · {relative(m.createdAt)}</div></li>)}</ul>
          )}
        </Card>
      </div>
      <ScheduleDialog open={scheduling} template={template} filters={filters} onClose={() => setScheduling(false)} />
      {printing && r && createPortal(<div className="print-only p-8"><h1 className="text-xl font-bold">{r.title}</h1><p className="mb-4 text-sm">{r.from} to {r.to}</p>{table}</div>, document.body)}
    </PageBody>
  );
}

export function ScheduleDialog({ open, template, filters, onClose }: { open: boolean; template: string; filters: { groupId: string; category: string }; onClose: () => void }) {
  const [cadence, setCadence] = useState('WEEKLY');
  const [recipients, setRecipients] = useState('');
  const save = useAction(() => api.post('/hq/reports/schedules', { template, cadence, recipients: recipients.split(/[,;\s]+/).filter(Boolean), filters: { groupId: filters.groupId || undefined, category: filters.category || undefined } }), { success: 'Report scheduled', invalidate: [['hq', 'schedules']], onSuccess: onClose });
  return (
    <Dialog open={open} onClose={onClose} size="sm" title="Schedule this report" description="Delivered as CSV by email, covering the period since the previous delivery."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!recipients} loading={save.isPending} onClick={() => save.mutate(undefined)}>Schedule</Button></>}>
      <div className="grid gap-3">
        <Field label="Cadence"><Select value={cadence} onChange={(e) => setCadence(e.target.value)}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></Select></Field>
        <Field label="Recipients" hint="Comma-separated email addresses"><Input value={recipients} onChange={(e) => setRecipients(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
