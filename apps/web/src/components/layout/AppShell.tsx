'use client';

import { MODULE_KEYS, type ModuleKey } from '@segue/shared';
import { ChevronDown, ChevronsLeft, ChevronsRight, Grid2x2, Lock, LogOut, MapPin, Settings, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ADMIN_NAV, MODULE_UI, showModule, type NavItem } from '@/lib/modules';
import { useSession } from '@/features/auth/session';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';

function currentModule(pathname: string): ModuleKey | null {
  const seg = pathname.split('/')[1]?.toUpperCase();
  return (MODULE_KEYS as readonly string[]).includes(seg ?? '') ? (seg as ModuleKey) : null;
}

/** Overrides the action accent for a subtree (rarely needed — teal is the global accent). */
export function accentStyle(color: string): CSSProperties {
  return { ['--accent' as string]: color };
}

const initials = (name?: string) => name?.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase() ?? '';

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
  const isAdmin = canAny('platform.users.manage', 'platform.audit.read', 'hq.config.read');
  const moduleNav = ui && hasModule(ui.key) ? visible(ui.nav) : [];

  return (
    <div className="flex h-full">
      <aside className={cn('no-print flex shrink-0 flex-col border-r border-[var(--line)] bg-white transition-[width] duration-200', collapsed ? 'w-[76px]' : 'w-[264px]')}>
        <button onClick={() => router.push('/')} className={cn('flex h-[72px] items-center gap-3 px-4 text-left', collapsed && 'justify-center px-0')}>
          {collapsed ? (
            <span className="rounded-md bg-primary-50 px-1.5 py-px text-[11px] font-bold text-primary-700">Rx</span>
          ) : (
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-display text-[17px] leading-tight font-extrabold tracking-tight text-ink-900">SEGUE</span>
                <span className="rounded-md bg-primary-50 px-1.5 py-px text-[10px] font-bold text-primary-700">Rx</span>
              </div>
              <div className="truncate text-xs text-ink-500">{session?.tenant?.name ?? 'Segue platform'}</div>
            </div>
          )}
        </button>

        <div className="flex-1 overflow-y-auto px-3 pb-3">
          {/* Workspace switcher: unlicensed workspaces show a lock; ones the user can't use are hidden. */}
          <NavSection label="Workspaces" collapsed={collapsed}>
            <SideLink item={{ to: '/', label: 'All workspaces', icon: Grid2x2, end: true }} collapsed={collapsed} />
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
                    'flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium transition-colors',
                    active ? 'bg-ink-100 font-semibold text-ink-900' : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900',
                    collapsed && 'justify-center px-0',
                  )}
                >
                  <span className="grid size-5 shrink-0 place-items-center">
                    {licensed ? <m.icon className="size-[18px]" style={{ color: m.color }} /> : <Lock className="size-4 text-ink-400" />}
                  </span>
                  {!collapsed && <span className={cn('flex-1', !licensed && 'text-ink-400')}>{m.label}</span>}
                  {!collapsed && active && <span className="size-2 rounded-full" style={{ background: m.color }} />}
                </Link>
              );
            })}
          </NavSection>

          {moduleNav.length > 0 && ui && (
            <NavSection label={ui.label} collapsed={collapsed}>
              {moduleNav.map((item) => <SideLink key={item.to} item={item} collapsed={collapsed} />)}
            </NavSection>
          )}
          {onAdmin && (
            <NavSection label="Administration" collapsed={collapsed}>
              {visible(ADMIN_NAV).map((item) => <SideLink key={item.to} item={item} collapsed={collapsed} />)}
            </NavSection>
          )}
        </div>

        <div className="space-y-1 border-t border-[var(--line)] p-3">
          {!onAdmin && (
            <Link
              href="/admin/licence"
              title={collapsed ? (isAdmin ? 'Administration' : 'Licence') : undefined}
              className={cn('flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium text-ink-600 hover:bg-ink-50 hover:text-ink-900', collapsed && 'justify-center px-0')}
            >
              {isAdmin ? <Settings className="size-[18px] shrink-0" /> : <ShieldCheck className="size-[18px] shrink-0" />}
              {!collapsed && (
                <>
                  <span className="flex-1">{isAdmin ? 'Administration' : 'Licence'}</span>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Active</span>
                </>
              )}
            </Link>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium text-ink-500 hover:bg-ink-50 hover:text-ink-900', collapsed && 'justify-center px-0')}
          >
            {collapsed ? <ChevronsRight className="size-[18px]" /> : <ChevronsLeft className="size-[18px]" />}
            {!collapsed && 'Collapse rail'}
          </button>
          <div className={cn('mt-2 flex items-center gap-3 rounded-2xl bg-ink-50 p-2.5', collapsed && 'justify-center bg-transparent p-0')}>
            <div className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-700 text-xs font-bold text-white">{initials(session?.user.name)}</div>
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-ink-900">{session?.user.name}</div>
                  <div className="truncate text-[11px] text-ink-500">{session?.roles.map((r) => r.label).join(' · ') || (session?.user.isPlatformAdmin ? 'Segue platform admin' : '')}</div>
                </div>
                <button
                  onClick={async () => {
                    await logout();
                    router.replace('/login');
                  }}
                  className="rounded-lg p-1.5 text-ink-400 hover:bg-white hover:text-rose-600"
                  title="Sign out"
                >
                  <LogOut className="size-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar moduleLabel={ui?.label ?? (onAdmin ? 'Administration' : 'Workspaces')} moduleColor={ui?.color} />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function NavSection({ label, collapsed, children }: { label: string; collapsed: boolean; children: ReactNode }) {
  return (
    <div className="pt-4">
      {collapsed ? <div className="mx-3 mb-2 border-t border-[var(--line)]" /> : <div className="eyebrow px-3 pb-2 text-ink-400">{label}</div>}
      <div className="space-y-0.5">{children}</div>
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
        'flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium transition-colors',
        isActive ? 'bg-tertiary-50 font-semibold text-tertiary-700' : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900',
        collapsed && 'justify-center px-0',
      )}
    >
      <item.icon className="size-[18px] shrink-0" />
      {!collapsed && item.label}
    </Link>
  );
}

function TopBar({ moduleLabel, moduleColor }: { moduleLabel: string; moduleColor?: string }) {
  const { session, store } = useSession();
  return (
    <header className="no-print flex h-[72px] shrink-0 items-center justify-between gap-4 border-b border-[var(--line)] bg-white/85 px-6 backdrop-blur lg:px-8">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        {moduleColor && <span className="size-2 rounded-full" style={{ background: moduleColor }} />}
        <span className="font-display font-bold text-ink-900">{moduleLabel}</span>
        {store && (
          <>
            <span className="text-ink-300">/</span>
            <span className="truncate text-ink-500">{store.name}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        <ConnectionPill />
        {session && session.stores.length > 0 && <StoreSwitcher />}
        <div className="grid size-9 place-items-center rounded-full bg-tertiary-50 text-xs font-bold text-tertiary-700" title={session?.user.name}>
          {initials(session?.user.name)}
        </div>
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
    <span className={cn('hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold sm:inline-flex', online ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800')}>
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
        className="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--line)] bg-white px-3.5 text-sm font-semibold text-ink-700 hover:bg-ink-50 disabled:cursor-default disabled:hover:bg-white"
      >
        <MapPin className="size-4 text-primary-700" />
        <span className="max-w-48 truncate">{store?.name ?? 'Select store'}</span>
        {!single && <ChevronDown className="size-4 text-ink-400" />}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-72 animate-in rounded-2xl border border-[var(--line)] bg-white p-1.5 shadow-[var(--shadow-pop)]">
          <div className="eyebrow px-2.5 py-1.5 text-ink-400">Switch store</div>
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
              className={cn('flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-sm hover:bg-ink-50', s.id === session.storeId && 'bg-[var(--accent-soft)]')}
            >
              <span>
                <span className="block font-semibold text-ink-900">{s.name}</span>
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
  return <div className={cn('mx-auto w-full px-6 py-8 lg:px-10', wide ? 'max-w-[1600px]' : 'max-w-7xl', className)}>{children}</div>;
}
