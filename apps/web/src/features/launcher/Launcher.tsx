'use client';

import { MODULE_KEYS, MODULES } from '@segue/shared';
import { ChevronRight, Lock } from 'lucide-react';
import Link from 'next/link';
import { PageBody } from '@/components/layout/AppShell';
import { ProductMark } from '@/components/layout/Brand';
import { StatusBadge } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { cn } from '@/lib/cn';
import { date } from '@/lib/format';
import { MODULE_UI } from '@/lib/modules';

/** Workspace launcher — all four products, with unlicensed ones shown locked. */
export function Launcher() {
  const { session, hasModule, store } = useSession();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return (
    <PageBody>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-ink-900">
          {greeting}, {session?.user.name.split(' ')[0]}
        </h1>
        <p className="mt-1 text-ink-500">
          {session?.tenant?.name}
          {store && <> · {store.name}</>}
        </p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        {MODULE_KEYS.map((k) => {
          const ui = MODULE_UI[k];
          const info = MODULES[k];
          const licensed = hasModule(k);
          const sub = session?.subscriptions.find((s) => s.module === k);
          return (
            <Link
              key={k}
              href={ui.path}
              className={cn(
                'group relative flex flex-col rounded-3xl bg-white p-8 shadow-[var(--shadow-card)] ring-1 ring-ink-200/70 transition-all',
                licensed ? 'hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]' : 'bg-white/60',
              )}
            >
              <div className="flex items-start justify-between">
                <div className={cn(!licensed && 'opacity-50 grayscale-[35%]')}>
                  <ProductMark module={ui.label} color={ui.color} size="lg" />
                </div>
                {licensed ? (
                  sub?.status === 'TRIAL' ? <StatusBadge status="TRIAL" /> : null
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-2.5 py-1 text-xs font-semibold text-ink-600">
                    <Lock className="size-3.5" /> {sub ? `Licence ${sub.status.toLowerCase()}` : 'Not licensed'}
                  </span>
                )}
              </div>
              <p className={cn('mt-6 text-[15px] leading-relaxed text-ink-600', !licensed && 'opacity-70')}>{info.description}</p>
              <div className="mt-2 text-xs text-ink-400">{info.audience}</div>
              <div className="mt-6 flex items-center justify-between">
                <span className="inline-flex items-center gap-1 text-sm font-bold tracking-wide text-ink-700 uppercase">
                  {licensed ? 'Open' : 'Learn more'}
                  <ChevronRight className="size-4 text-brand transition-transform group-hover:translate-x-0.5" />
                </span>
                {sub?.expiresAt && licensed && <span className="text-xs text-ink-400">Renews {date(sub.expiresAt)}</span>}
              </div>
            </Link>
          );
        })}
      </div>
    </PageBody>
  );
}
