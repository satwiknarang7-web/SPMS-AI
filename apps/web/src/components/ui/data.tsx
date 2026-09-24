'use client';

import { ArrowDownRight, ArrowUpRight, Inbox, Search } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Input, Spinner } from './primitives';

export function PageHeader({ title, subtitle, actions, eyebrow, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && <div className="mb-2">{back}</div>}
        {eyebrow && <div className="mb-1 text-xs font-semibold tracking-wider text-[var(--accent)] uppercase">{eyebrow}</div>}
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, delta, hint, icon, tone }: { label: ReactNode; value: ReactNode; delta?: number | null; hint?: ReactNode; icon?: ReactNode; tone?: 'accent' | 'amber' | 'red' | 'green' }) {
  const toneCls = { accent: 'bg-[var(--accent-soft)] text-[var(--accent)]', amber: 'bg-amber-50 text-amber-600', red: 'bg-rose-50 text-rose-600', green: 'bg-emerald-50 text-emerald-600' };
  return (
    <div className="rounded-2xl bg-white p-4 shadow-[var(--shadow-card)] ring-1 ring-ink-200/70">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[13px] font-medium text-ink-500">{label}</div>
        {icon && <span className={cn('grid size-8 place-items-center rounded-lg [&>svg]:size-4', toneCls[tone ?? 'accent'])}>{icon}</span>}
      </div>
      <div className="mt-1.5 text-2xl font-bold tracking-tight text-ink-900 tnum">{value}</div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {delta != null && Number.isFinite(delta) && (
          <span className={cn('inline-flex items-center gap-0.5 font-semibold', delta >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
            {delta >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
        {hint && <span className="text-ink-500">{hint}</span>}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-ink-100 text-ink-400 [&>svg]:size-6">{icon ?? <Inbox />}</div>
      <div className="font-semibold text-ink-800">{title}</div>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function NotFound({ what = 'record' }: { what?: string }) {
  return <EmptyState title={`That ${what} couldn't be found`} description="It may have been removed, or it belongs to a different store. Check the store selected in the top bar." />;
}

export function Loading({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-16 text-sm text-ink-500', className)}>
      <Spinner /> {label}
    </div>
  );
}

/** Debounced search box. */
export function SearchInput({ value, onChange, placeholder, autoFocus, className, delay = 250, shortcut }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; className?: string; delay?: number; shortcut?: string }) {
  const [local, setLocal] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setLocal(value), [value]);
  useEffect(() => {
    const t = setTimeout(() => local !== value && onChange(local), delay);
    return () => clearTimeout(t);
  }, [local, delay, onChange, value]);
  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === shortcut && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcut]);
  return <Input ref={ref} icon={<Search />} value={local} onChange={(e) => setLocal(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} className={className} />;
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('inline-flex rounded-xl bg-ink-100 p-1', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cn('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors', value === t.value ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800')}
        >
          {t.label}
          {t.count != null && <span className={cn('rounded-full px-1.5 text-[11px] tnum', value === t.value ? 'bg-[var(--accent-soft)] text-[var(--accent-strong)]' : 'bg-ink-200 text-ink-600')}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------- Table ---------------------------------- */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}
export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-ink-200 bg-ink-50/70 text-[11px] font-semibold tracking-wider text-ink-500 uppercase">{children}</thead>;
}
export function TH({ children, className, align }: { children?: ReactNode; className?: string; align?: 'right' | 'center' }) {
  return <th className={cn('px-4 py-2.5 font-semibold whitespace-nowrap', align === 'right' && 'text-right', align === 'center' && 'text-center', className)}>{children}</th>;
}
export function TR({ children, onClick, className, active }: { children: ReactNode; onClick?: () => void; className?: string; active?: boolean }) {
  return (
    <tr onClick={onClick} className={cn('border-b border-ink-100 last:border-0', onClick && 'cursor-pointer hover:bg-ink-50/80', active && 'bg-[var(--accent-soft)]/60', className)}>
      {children}
    </tr>
  );
}
export function TD({ children, className, align, mono }: { children?: ReactNode; className?: string; align?: 'right' | 'center'; mono?: boolean }) {
  return <td className={cn('px-4 py-3 align-middle text-ink-700', align === 'right' && 'text-right tnum', align === 'center' && 'text-center', mono && 'font-mono text-xs', className)}>{children}</td>;
}

export function DescriptionList({ items, columns = 2 }: { items: { label: ReactNode; value: ReactNode }[]; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3', columns === 2 && 'sm:grid-cols-2', columns === 3 && 'sm:grid-cols-3')}>
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-medium text-ink-500">{it.label}</dt>
          <dd className="mt-0.5 truncate text-sm text-ink-900">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Sparkline({ values, className, color = 'var(--accent)' }: { values: number[]; className?: string; color?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((v - min) / (max - min || 1)) * 28}`).join(' ');
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={cn('h-8 w-24', className)}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function ProgressBar({ value, max, className, tone }: { value: number; max: number; className?: string; tone?: string }) {
  const p = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-ink-100', className)}>
      <div className="h-full rounded-full transition-all" style={{ width: `${p}%`, background: tone ?? 'var(--accent)' }} />
    </div>
  );
}
