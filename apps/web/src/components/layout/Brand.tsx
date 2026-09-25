import { cn } from '@/lib/cn';

/**
 * Product wordmark: "SEGUE" + module name in the module colour over a gradient bar with
 * a "+ PLUS" pill — a family look shared by the four workspaces.
 */
export function ProductMark({ module, color, size = 'md', inverted }: { module?: string; color?: string; size?: 'sm' | 'md' | 'lg'; inverted?: boolean }) {
  const text = { sm: 'text-lg', md: 'text-2xl', lg: 'text-[34px]' }[size];
  const bar = { sm: 'h-2', md: 'h-2.5', lg: 'h-3' }[size];
  const pill = { sm: 'text-[7px] px-1.5 py-[1px]', md: 'text-[8px] px-2 py-[2px]', lg: 'text-[9px] px-2.5 py-[3px]' }[size];
  const c = color ?? 'var(--accent)';
  return (
    <div className="inline-flex min-w-[9rem] flex-col leading-none select-none">
      <div className={cn('font-display font-extrabold tracking-[-0.03em] uppercase', text)}>
        <span className={inverted ? 'text-white' : 'text-ink-900'}>Segue</span>
        {module && (
          <span className="ml-[0.25em]" style={{ color: c }}>
            {module}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className={cn('flex-1 rounded-full', bar)} style={{ background: `linear-gradient(90deg, ${c}, color-mix(in srgb, ${c} 35%, white))` }} />
        <span className={cn('rounded-full font-bold tracking-wider text-white', pill)} style={{ background: c }}>
          + PLUS
        </span>
      </div>
    </div>
  );
}

/** Square logo tile used in the sidebar and on the sign-in page. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl bg-primary-700 text-white shadow-[0_6px_14px_-6px_rgb(15_118_110/0.7)]', className)}>
      <svg viewBox="0 0 64 64" className="size-6" aria-hidden>
        <path d="M42 20c-2.6-2.4-6-3.6-9.8-3.6-6.6 0-11 3.4-11 8.4 0 11 20.4 6.6 20.4 14.6 0 3.2-3.2 5.4-8 5.4-4.2 0-7.8-1.6-10.6-4.4" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
        <rect x="14" y="52" width="36" height="5" rx="2.5" fill="#6fdec8" />
      </svg>
    </span>
  );
}
