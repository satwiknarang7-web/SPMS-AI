import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { errorMessage } from './api';

/**
 * Mutation with consistent UX: success toast, error toast with server message,
 * and invalidation of the affected queries.
 */
export function useAction<TVars, TData>(fn: (vars: TVars) => Promise<TData>, opts: { success?: string | ((data: TData) => string); invalidate?: QueryKey[]; onSuccess?: (data: TData, vars: TVars) => void } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data, vars) => {
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(data) : opts.success);
      for (const key of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: key });
      opts.onSuccess?.(data, vars);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

/** Global keyboard shortcut (ignored while typing in a field unless `allowInInputs`). */
export function useHotkey(key: string, handler: (e: KeyboardEvent) => void, opts: { allowInInputs?: boolean; enabled?: boolean } = {}) {
  useEffect(() => {
    if (opts.enabled === false) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (!opts.allowInInputs && ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if (e.key === key) {
        e.preventDefault();
        handler(e);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, handler, opts.allowInInputs, opts.enabled]);
}
