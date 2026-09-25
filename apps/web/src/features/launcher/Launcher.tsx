'use client';

import { MODULE_KEYS, MODULES } from '@segue/shared';
import { ArrowRight, CalendarDays, Lock } from 'lucide-react';
import Link from 'next/link';
import { PageBody } from '@/components/layout/AppShell';
import { ProductMark } from '@/components/layout/Brand';
import { Chip, StatusBadge } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { cn } from '@/lib/cn';
import { date } from '@/lib/format';
import { MODULE_UI, showModule } from '@/lib/modules';

/** Workspace launcher — the user's products, with unlicensed ones shown locked. */
export function Launcher() {
  const { session, hasModule, canAny, store } = useSession();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const licensedCount = MODULE_KEYS.filter((k) => hasModule(k)).length;
  const tier = licensedCount === MODULE_KEYS.length ? 'Enterprise Suite Tier' : `${licensedCount} of ${MODULE_KEYS.length} modules licensed`;
  return (
    <PageBody>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-ink-500">
            <span className="size-1.5 rounded-full bg-primary-500" />
            <span className="eyebrow">Workspace portal</span>
          </div>
          <h1 className="text-[30px] leading-tight font-extrabold text-ink-900">
            {greeting}, {session?.user.name.split(' ')[0]}
          </h1>
          <p className="mt-1.5 text-sm text-ink-500">
            {session?.tenant?.name}
            {store && <> · {store.name}</>}
          </p>
        </div>
        <Chip tone="primary">{tier}</Chip>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {MODULE_KEYS.filter((k) => showModule(k, hasModule, canAny)).map((k) => {
          const ui = MODULE_UI[k];
          const info = MODULES[k];
          const licensed = hasModule(k);
          const sub = session?.subscriptions.find((s) => s.module === k);
          return (
            <Link
              key={k}
              href={ui.path}
              className={cn(
                'group relative flex flex-col rounded-[22px] border border-[var(--line)] bg-white p-7 shadow-[var(--shadow-card)] transition-all',
                licensed ? 'hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]' : 'bg-white/70',
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className={cn(!licensed && 'opacity-50 grayscale-[35%]')}>
                  <ProductMark module={ui.label} color={ui.color} size="lg" />
                </div>
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl" style={{ background: licensed ? `color-mix(in srgb, ${ui.color} 10%, white)` : undefined, color: licensed ? ui.color : undefined }}>
                  {licensed ? <ui.icon className="size-6" /> : <Lock className="size-5 text-ink-400" />}
                </span>
              </div>
              <p className={cn('mt-6 text-[15px] leading-relaxed text-ink-600', !licensed && 'opacity-70')}>{info.description}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Chip>{info.audience}</Chip>
                {licensed && sub?.status === 'TRIAL' && <StatusBadge status="TRIAL" />}
                {!licensed && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-2.5 py-1 text-xs font-semibold text-ink-600">
                    <Lock className="size-3.5" /> {sub ? `Licence ${sub.status.toLowerCase()}` : 'Not licensed'}
                  </span>
                )}
              </div>
              <div className="mt-7 flex items-center justify-between border-t border-[var(--line)] pt-5">
                <span
                  className={cn('inline-flex h-10 items-center gap-2 rounded-xl px-5 text-[13px] font-bold tracking-wider uppercase transition-all', licensed ? 'text-white group-hover:gap-3' : 'bg-ink-100 text-ink-600')}
                  style={licensed ? { background: ui.color } : undefined}
                >
                  {licensed ? 'Open' : 'Learn more'}
                  <ArrowRight className="size-4" />
                </span>
                {sub?.expiresAt && licensed && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500">
                    <CalendarDays className="size-3.5" /> Renews {date(sub.expiresAt)}
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </PageBody>
  );
}
