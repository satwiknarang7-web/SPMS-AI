import { cn } from '@/lib/cn';

/**
 * Product wordmark: "SEGUE" + module name in the module colour over a colour bar with
 * "+ PLUS" — a family look shared by the four workspaces.
 */
export function ProductMark({ module, color, size = 'md', inverted }: { module?: string; color?: string; size?: 'sm' | 'md' | 'lg'; inverted?: boolean }) {
  const text = { sm: 'text-lg', md: 'text-2xl', lg: 'text-4xl' }[size];
  const bar = { sm: 'h-2.5 text-[7px]', md: 'h-3.5 text-[9px]', lg: 'h-5 text-[12px]' }[size];
  return (
    <div className="inline-flex flex-col leading-none select-none">
      <div className={cn('font-extrabold tracking-[-0.02em] uppercase', text)}>
        <span className={inverted ? 'text-white' : 'text-ink-800'}>Segue</span>
        {module && (
          <span className="ml-[0.28em]" style={{ color: color ?? 'var(--accent)' }}>
            {module}
          </span>
        )}
      </div>
      <div className={cn('mt-[3px] flex items-center justify-end rounded-[2px] px-1.5 font-bold tracking-wider text-white', bar)} style={{ background: color ?? 'var(--color-brand)' }}>
        + PLUS
      </div>
    </div>
  );
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn('grid size-8 place-items-center rounded-lg bg-white/10 ring-1 ring-white/15', className)}>
      <svg viewBox="0 0 64 64" className="size-5">
        <path d="M42 20c-2.6-2.4-6-3.6-9.8-3.6-6.6 0-11 3.4-11 8.4 0 11 20.4 6.6 20.4 14.6 0 3.2-3.2 5.4-8 5.4-4.2 0-7.8-1.6-10.6-4.4" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
        <rect x="14" y="52" width="36" height="5" rx="2.5" fill="var(--accent)" />
      </svg>
    </span>
  );
}
