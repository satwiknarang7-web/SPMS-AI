'use client';

import { MODULE_KEYS, type ModuleKey } from '@segue/shared';
import { ChevronDown, ChevronsLeft, ChevronsRight, Grid2x2, Lock, LogOut, MapPin, Settings } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ADMIN_NAV, MODULE_UI, showModule, type NavItem } from '@/lib/modules';
import { useSession } from '@/features/auth/session';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { LogoMark } from './Brand';

function currentModule(pathname: string): ModuleKey | null {
  const seg = pathname.split('/')[1]?.toUpperCase();
  return (MODULE_KEYS as readonly string[]).includes(seg ?? '') ? (seg as ModuleKey) : null;
}

export function accentStyle(color: string): CSSProperties {
  return { ['--accent' as string]: color };
}

export function AppShell({ children }: { children: ReactNode }) {
  const { session, hasModule, canAny, logout } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const mod = currentModule(pathname);
  const ui = mod ? MODULE_UI[mod] : null;
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem('segue.sidebar') === 'collapsed');
    } catch {
      /* storage unavailable */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('segue.sidebar', collapsed ? 'collapsed' : 'open');
    } catch {
      /* storage unavailable */
    }
  }, [collapsed]);

  const visible = (items: NavItem[]) => items.filter((i) => !i.perm || canAny(...i.perm));
  const onAdmin = pathname.startsWith('/admin');
  const accent = ui?.color ?? '#7c4dbd';

  return (
    <div className="flex h-full" style={accentStyle(accent)}>
      <aside className={cn('no-print flex shrink-0 flex-col bg-ink-950 text-ink-300 transition-[width] duration-200', collapsed ? 'w-[68px]' : 'w-64')}>
        <button onClick={() => router.push('/')} className="flex h-16 items-center gap-3 px-4 text-left text-white hover:bg-white/5">
          <LogoMark />
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-[15px] leading-tight font-extrabold tracking-tight">SEGUE</div>
              <div className="truncate text-[11px] text-ink-400">{session?.tenant?.name ?? 'Segue platform'}</div>
            </div>
          )}
        </button>

        {/* Module switcher: unlicensed workspaces show a lock; ones the user can't use are hidden. */}
        <div className={cn('px-3 pt-2 pb-3', !collapsed && 'border-b border-white/5')}>
          {!collapsed && <div className="px-2 pb-2 text-[10px] font-semibold tracking-[0.14em] text-ink-500 uppercase">Workspaces</div>}
          <div className={cn('grid gap-1', collapsed ? 'grid-cols-1' : 'grid-cols-2')}>
            {MODULE_KEYS.filter((k) => showModule(k, hasModule, canAny)).map((k) => {
              const m = MODULE_UI[k];
              const licensed = hasModule(k);
              const active = mod === k;
              return (
                <Link
                  key={k}
                  href={m.path}
                  title={licensed ? m.label : `${m.label} — not licensed`}
                  className={cn(
                    'group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-medium transition-colors',
                    active ? 'bg-white/10 text-white' : 'text-ink-400 hover:bg-white/5 hover:text-ink-200',
                    collapsed && 'justify-center',
                  )}
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-md" style={{ background: licensed ? `${m.color}22` : 'transparent', color: licensed ? m.color : undefined }}>
                    {licensed ? <m.icon className="size-3.5" /> : <Lock className="size-3.5" />}
                  </span>
                  {!collapsed && <span className={cn(!licensed && 'opacity-60')}>{m.label}</span>}
                  {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full" style={{ background: m.color }} />}
                </Link>
              );
            })}
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
          {ui && hasModule(ui.key) && visible(ui.nav).map((item) => <SideLink key={item.to} item={item} collapsed={collapsed} />)}
          {!ui && !onAdmin && (
            <SideLink item={{ to: '/', label: 'All workspaces', icon: Grid2x2, end: true }} collapsed={collapsed} />
          )}
          {onAdmin && visible(ADMIN_NAV).map((item) => <SideLink key={item.to} item={item} collapsed={collapsed} />)}
        </nav>

        <div className="space-y-1 border-t border-white/5 p-3">
          {canAny('platform.users.manage', 'platform.audit.read', 'hq.config.read') && !onAdmin && (
            <SideLink item={{ to: '/admin/licence', label: 'Administration', icon: Settings }} collapsed={collapsed} />
          )}
          {!onAdmin && !canAny('platform.users.manage', 'platform.audit.read', 'hq.config.read') && (
            <SideLink item={{ to: '/admin/licence', label: 'Licence', icon: Settings }} collapsed={collapsed} />
          )}
          <button onClick={() => setCollapsed((c) => !c)} className={cn('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] text-ink-500 hover:bg-white/5 hover:text-ink-200', collapsed && 'justify-center')}>
            {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
            {!collapsed && 'Collapse'}
          </button>
          <div className={cn('flex items-center gap-3 rounded-xl bg-white/5 p-2', collapsed && 'justify-center')}>
            <div className="grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold text-white" style={{ background: accent }}>
              {session?.user.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-white">{session?.user.name}</div>
                <div className="truncate text-[11px] text-ink-400">{session?.roles.map((r) => r.label).join(' · ') || (session?.user.isPlatformAdmin ? 'Segue platform admin' : '')}</div>
              </div>
            )}
            {!collapsed && (
              <button
                onClick={async () => {
                  await logout();
                  router.replace('/login');
                }}
                className="rounded-md p-1.5 text-ink-400 hover:bg-white/10 hover:text-white"
                title="Sign out"
              >
                <LogOut className="size-4" />
              </button>
            )}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar moduleLabel={ui?.label ?? (onAdmin ? 'Administration' : 'Workspaces')} />
        <main className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

function SideLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const pathname = usePathname();
  const isActive = item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);
  return (
    <Link
      href={item.to}
      title={collapsed ? item.label : undefined}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
        isActive ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-ink-400 hover:bg-white/5 hover:text-ink-100',
        collapsed && 'justify-center',
      )}
    >
      <item.icon className="size-4 shrink-0" />
      {!collapsed && item.label}
    </Link>
  );
}

function TopBar({ moduleLabel }: { moduleLabel: string }) {
  const { session, store } = useSession();
  return (
    <header className="no-print flex h-16 shrink-0 items-center justify-between gap-4 border-b border-ink-200/70 bg-white/80 px-6 backdrop-blur">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-semibold text-ink-900">{moduleLabel}</span>
        {store && (
          <>
            <span className="text-ink-300">/</span>
            <span className="text-ink-500">{store.name}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        <ConnectionPill />
        {session && session.stores.length > 0 && <StoreSwitcher />}
      </div>
    </header>
  );
}

function ConnectionPill() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return (
    <span className={cn('hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex', online ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800')}>
      <span className={cn('size-1.5 rounded-full', online ? 'bg-emerald-500' : 'bg-amber-500')} />
      {online ? 'Online' : 'Offline'}
    </span>
  );
}

function StoreSwitcher() {
  const { session, store, switchStore } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  if (!session) return null;
  const single = session.stores.length === 1;
  return (
    <div ref={ref} className="relative">
      <button
        disabled={single}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 items-center gap-2 rounded-lg bg-white px-3 text-sm font-medium text-ink-700 ring-1 ring-ink-200 hover:bg-ink-50 disabled:cursor-default disabled:hover:bg-white"
      >
        <MapPin className="size-4 text-[var(--accent)]" />
        <span className="max-w-48 truncate">{store?.name ?? 'Select store'}</span>
        {!single && <ChevronDown className="size-4 text-ink-400" />}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-72 animate-in rounded-xl bg-white p-1.5 shadow-[var(--shadow-pop)] ring-1 ring-ink-200">
          <div className="px-2.5 py-1.5 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">Switch store</div>
          {session.stores.map((s) => (
            <button
              key={s.id}
              onClick={async () => {
                setOpen(false);
                try {
                  await switchStore(s.id);
                  toast.success(`Now working in ${s.name}`);
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}
              className={cn('flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm hover:bg-ink-50', s.id === session.storeId && 'bg-[var(--accent-soft)]')}
            >
              <span>
                <span className="block font-medium text-ink-900">{s.name}</span>
                <span className="block text-xs text-ink-500">{s.code} · {s.suburb} {s.state}</span>
              </span>
              {s.id === session.storeId && <span className="size-2 rounded-full bg-[var(--accent)]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PageBody({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn('mx-auto w-full px-6 py-6 lg:px-8', wide ? 'max-w-[1600px]' : 'max-w-7xl', className)}>{children}</div>;
}
