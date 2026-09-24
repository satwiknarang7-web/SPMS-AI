import { formatCents } from '@segue/shared';

export const money = formatCents;

export const moneyCompact = (cents: number | null | undefined) => {
  if (cents == null) return '—';
  const d = cents / 100;
  if (Math.abs(d) >= 1_000_000) return `$${(d / 1_000_000).toFixed(2)}M`;
  if (Math.abs(d) >= 10_000) return `$${(d / 1000).toFixed(1)}k`;
  return formatCents(cents);
};

export const pct = (n: number | null | undefined, digits = 1) => (n == null || Number.isNaN(n) ? '—' : `${n.toFixed(digits)}%`);
export const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-AU'));

const dateFmt = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' });

export const date = (d: string | Date | null | undefined) => (d ? dateFmt.format(new Date(d)) : '—');
export const dateTime = (d: string | Date | null | undefined) => (d ? dateTimeFmt.format(new Date(d)) : '—');
export const time = (d: string | Date | null | undefined) => (d ? timeFmt.format(new Date(d)) : '—');

export function relative(d: string | Date | null | undefined) {
  if (!d) return '—';
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  const abs = Math.abs(diff);
  const fut = diff < 0;
  const f = (n: number, u: string) => `${fut ? 'in ' : ''}${Math.round(n)} ${u}${Math.round(n) === 1 ? '' : 's'}${fut ? '' : ' ago'}`;
  if (abs < 60) return fut ? 'in a moment' : 'just now';
  if (abs < 3600) return f(abs / 60, 'min');
  if (abs < 86400) return f(abs / 3600, 'hour');
  if (abs < 86400 * 30) return f(abs / 86400, 'day');
  return date(d);
}

export const age = (dob: string | Date) => Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86_400_000));

/** Dollars string from an input → cents. Returns null when invalid. */
export function parseMoney(input: string): number | null {
  const s = input.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  return Math.round(Number.parseFloat(s) * 100);
}

export const dollars = (cents: number) => (cents / 100).toFixed(2);

export const titleCase = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const todayISO = () => new Date().toISOString().slice(0, 10);
export const daysAgoISO = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
