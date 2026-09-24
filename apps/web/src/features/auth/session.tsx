'use client';

import type { ModuleKey, Permission } from '@segue/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';

export interface Session {
  user: { id: string; name: string; email: string; isPlatformAdmin: boolean };
  tenant: { id: string; name: string } | null;
  stores: { id: string; code: string; name: string; suburb: string; state: string }[];
  storeId: string | null;
  sessionId?: string;
  accessTokenExpiresAt?: string;
  roles: { key: string; label: string }[];
  modules: ModuleKey[];
  subscriptions: { module: ModuleKey; name: string; status: string; expiresAt: string | null; usable: boolean }[];
  permissions: Permission[];
}

interface SessionContextValue {
  session: Session | null;
  loading: boolean;
  can: (...perms: Permission[]) => boolean;
  canAny: (...perms: Permission[]) => boolean;
  hasModule: (m: ModuleKey) => boolean;
  store: Session['stores'][number] | null;
  login: (email: string, password: string) => Promise<Session>;
  logout: () => Promise<void>;
  switchStore: (storeId: string) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        return await api.get<Session>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  // Any 401 from the API (expired session, deactivated user) returns to sign-in.
  useEffect(() => {
    const onUnauthorised = () => qc.setQueryData(['session'], null);
    window.addEventListener('segue:unauthorised', onUnauthorised);
    return () => window.removeEventListener('segue:unauthorised', onUnauthorised);
  }, [qc]);

  const login = useCallback(
    async (email: string, password: string) => {
      const s = await api.post<Session>('/auth/login', { email, password });
      // Drop another user's cached data, but keep the session query itself alive:
      // clearing it would orphan the observer and the new session would never render.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
      qc.setQueryData(['session'], s);
      return s;
    },
    [qc],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
    qc.setQueryData(['session'], null);
  }, [qc]);

  const switchStore = useCallback(
    async (storeId: string) => {
      const s = await api.post<Session>('/auth/switch-store', { storeId });
      // Everything store-scoped must be refetched for the new store.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
      qc.setQueryData(['session'], s);
    },
    [qc],
  );

  const value = useMemo<SessionContextValue>(() => {
    const perms = new Set(data?.permissions ?? []);
    return {
      session: data ?? null,
      loading: isLoading,
      can: (...p) => p.every((x) => perms.has(x)),
      canAny: (...p) => p.some((x) => perms.has(x)),
      hasModule: (m) => !!data?.modules.includes(m),
      store: data?.stores.find((s) => s.id === data.storeId) ?? null,
      login,
      logout,
      switchStore,
    };
  }, [data, isLoading, login, logout, switchStore]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
