'use client';

import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/* --------------------------------- Button --------------------------------- */

/**
 * primary   solid teal — the main action on a screen
 * secondary white, outlined — neutral actions (alias: outline)
 * tonal     soft lavender — quiet secondary actions ("Secondary" in the style sheet)
 * inverted  solid slate — emphatic neutral actions (alias: dark)
 */
type Variant = 'primary' | 'secondary' | 'outline' | 'tonal' | 'ghost' | 'danger' | 'accent-soft' | 'inverted' | 'dark';
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const variants: Record<Variant, string> = {
  primary: 'bg-[var(--accent)] text-white shadow-[0_1px_2px_rgb(15_118_110/0.25)] hover:bg-[var(--accent-strong)] disabled:opacity-50',
  secondary: 'bg-white text-ink-800 ring-1 ring-inset ring-[var(--line)] shadow-[0_1px_2px_rgb(15_23_42/0.04)] hover:bg-ink-50 hover:ring-ink-300 disabled:opacity-50',
  outline: 'bg-white text-ink-800 ring-1 ring-inset ring-ink-300 hover:bg-ink-50 disabled:opacity-50',
  tonal: 'bg-tertiary-50 text-ink-800 hover:bg-tertiary-100 disabled:opacity-50',
  ghost: 'text-ink-600 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-40',
  danger: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700 disabled:opacity-50',
  'accent-soft': 'bg-[var(--accent-soft)] text-[var(--accent-strong)] hover:brightness-95 disabled:opacity-50',
  inverted: 'bg-ink-800 text-white hover:bg-ink-900 disabled:opacity-50',
  dark: 'bg-ink-800 text-white hover:bg-ink-900 disabled:opacity-50',
};
const sizes: Record<Size, string> = {
  xs: 'h-7 px-2.5 text-xs gap-1 rounded-md',
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-9 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-sm gap-2 rounded-xl',
  xl: 'h-13 px-6 text-[15px] gap-2.5 rounded-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn('inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap transition-colors select-none disabled:cursor-not-allowed', variants[variant], sizes[size], className)}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

/** Circular icon-only action (the coloured round buttons in the style sheet). */
export function IconButton({ label, tone = 'primary', className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tone?: 'primary' | 'secondary' | 'tertiary' | 'danger' | 'neutral' }) {
  const t = { primary: 'bg-primary-700 text-white hover:bg-primary-800', secondary: 'bg-secondary-700 text-white hover:bg-secondary-800', tertiary: 'bg-tertiary-600 text-white hover:bg-tertiary-700', danger: 'bg-rose-700 text-white hover:bg-rose-800', neutral: 'bg-white text-ink-600 ring-1 ring-[var(--line)] hover:bg-ink-50' }[tone];
  return (
    <button type="button" aria-label={label} title={label} className={cn('grid size-9 shrink-0 place-items-center rounded-full transition-colors [&>svg]:size-4', t, className)} {...rest}>
      {children}
    </button>
  );
}

/* --------------------------------- Inputs --------------------------------- */

const fieldBase =
  'w-full rounded-lg border border-[var(--line)] bg-[#f7f8fe] text-sm text-ink-900 placeholder:text-ink-400 transition-colors hover:border-ink-300 focus:border-[var(--accent)] focus:bg-white focus:ring-3 focus:ring-[var(--accent-soft)] focus:outline-none disabled:bg-ink-100 disabled:text-ink-500';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode; suffix?: ReactNode }>(function Input({ className, icon, suffix, ...rest }, ref) {
  if (!icon && !suffix) return <input ref={ref} className={cn(fieldBase, 'h-10 px-3', className)} {...rest} />;
  return (
    <div className={cn('relative', className)}>
      {icon && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-400 [&>svg]:size-4">{icon}</span>}
      <input ref={ref} className={cn(fieldBase, 'h-10', icon ? 'pl-9' : 'pl-3', suffix ? 'pr-16' : 'pr-3')} {...rest} />
      {suffix && <span className="absolute inset-y-0 right-2 flex items-center">{suffix}</span>}
    </div>
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn(fieldBase, 'h-10 pr-8 pl-3', className)} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, 'min-h-20 px-3 py-2', className)} {...rest} />;
});

export function Field({ label, hint, error, children, className, required }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-[13px] font-semibold text-ink-700">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs text-rose-600">{error}</span> : hint ? <span className="mt-1 block text-xs text-ink-500">{hint}</span> : null}
    </label>
  );
}

export function Checkbox({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-sm text-ink-700', disabled && 'cursor-not-allowed opacity-60')}>
      <input type="checkbox" className="size-4 rounded border-ink-300 accent-[var(--accent)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2 text-sm text-ink-700 disabled:opacity-50">
      <span className={cn('relative inline-flex h-5 w-9 items-center rounded-full transition-colors', checked ? 'bg-[var(--accent)]' : 'bg-ink-300')}>
        <span className={cn('inline-block size-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4.5' : 'translate-x-0.5')} />
      </span>
      {label}
    </button>
  );
}

/* ---------------------------------- Badge ---------------------------------- */

type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'accent' | 'teal';
const tones: Record<Tone, string> = {
  neutral: 'bg-ink-100 text-ink-700',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-800',
  red: 'bg-rose-50 text-rose-700',
  blue: 'bg-secondary-50 text-secondary-700',
  violet: 'bg-tertiary-50 text-tertiary-700',
  teal: 'bg-primary-50 text-primary-800',
  accent: 'bg-[var(--accent-soft)] text-[var(--accent-strong)]',
};

export function Badge({ tone = 'neutral', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap', tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  ACTIVE: 'green', APPLIED: 'green', COMPLETED: 'green', COLLECTED: 'green', READY: 'teal', PUBLISHED: 'green', RECEIVED: 'green', POSTED: 'green', OK: 'green', SUCCESS: 'green', CONNECTED: 'green', AVAILABLE: 'green', RETURNED: 'neutral', CLOSED: 'neutral',
  TRIAL: 'blue', IN_PROGRESS: 'blue', SUBMITTED: 'blue', COUNTING: 'blue', SCHEDULED: 'violet', VALIDATED: 'violet', OPEN: 'blue', ON_HIRE: 'blue', APPROVED: 'violet',
  AWAITING_CHECK: 'amber', QUEUED: 'amber', PARTIALLY_RECEIVED: 'amber', REVIEW: 'amber', DRAFT: 'neutral', DEFERRED: 'amber', OUTLIER: 'amber', PARTIALLY_REFUNDED: 'amber', MAINTENANCE: 'amber', NOT_CONFIGURED: 'amber', ON_HOLD: 'neutral', SKIPPED: 'neutral', SUPERSEDED: 'neutral',
  SUSPENDED: 'red', EXPIRED: 'red', FAILED: 'red', CANCELLED: 'red', REJECTED: 'red', ROLLED_BACK: 'red', ERROR: 'red', UNMATCHED: 'red', REFUNDED: 'red', NOT_PURCHASED: 'neutral',
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge tone={STATUS_TONES[status] ?? 'neutral'} dot>
      {label ?? status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
    </Badge>
  );
}

/** Small bordered chip for metadata ("PBS Ready", "Pharmacists & technicians"). */
export function Chip({ icon, children, className, tone = 'neutral' }: { icon?: ReactNode; children: ReactNode; className?: string; tone?: 'neutral' | 'primary' | 'secondary' | 'tertiary' }) {
  const t = { neutral: 'bg-white text-ink-600 ring-[var(--line)]', primary: 'bg-primary-50 text-primary-800 ring-primary-100', secondary: 'bg-secondary-50 text-secondary-700 ring-secondary-100', tertiary: 'bg-tertiary-50 text-tertiary-700 ring-tertiary-100' }[tone];
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium ring-1 ring-inset [&>svg]:size-3.5', t, className)}>
      {icon}
      {children}
    </span>
  );
}

/* ---------------------------------- Card ---------------------------------- */

export function Card({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <div className={cn('rounded-[var(--radius-card)] border border-[var(--line)] bg-white shadow-[var(--shadow-card)]', padded && 'p-6', className)}>{children}</div>;
}

export function CardHeader({ title, subtitle, actions, icon, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-tertiary-50 text-[var(--accent)] [&>svg]:size-4">{icon}</span>}
        <div className="min-w-0">
          <h3 className="text-base font-bold text-ink-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[13px] text-ink-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Uppercase section label used inside cards ("PATIENT INFORMATION"). */
export function SectionLabel({ children, className, action }: { children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-3', className)}>
      <span className="eyebrow text-ink-500">{children}</span>
      {action}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-5 animate-spin text-ink-400', className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md bg-black/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-current opacity-80">{children}</kbd>;
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px bg-[var(--line)]', className)} />;
}

export function Alert({ tone = 'amber', title, children, icon, className }: { tone?: 'amber' | 'red' | 'blue' | 'green'; title?: ReactNode; children?: ReactNode; icon?: ReactNode; className?: string }) {
  const map = { amber: 'bg-amber-50 border-amber-200 text-amber-900', red: 'bg-rose-50 border-rose-200 text-rose-900', blue: 'bg-secondary-50 border-secondary-100 text-secondary-800', green: 'bg-emerald-50 border-emerald-200 text-emerald-900' };
  return (
    <div className={cn('flex gap-3 rounded-xl border p-3.5 text-sm', map[tone], className)}>
      {icon && <span className="mt-0.5 shrink-0 [&>svg]:size-4">{icon}</span>}
      <div className="min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn(title && 'mt-0.5', 'opacity-90')}>{children}</div>}
      </div>
    </div>
  );
}
