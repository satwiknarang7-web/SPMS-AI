'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

type Next = URLSearchParams | Record<string, string>;

/**
 * Read and update the URL query string (filters, tabs) without adding history entries.
 * Next.js' `useSearchParams` is read-only; this pairs it with a setter that replaces the URL.
 * Components using it must render inside a <Suspense> boundary (the workspace layout has one).
 */
export function useUrlSearchParams(): [URLSearchParams, (next: Next, opts?: { replace?: boolean }) => void] {
  const current = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const params = useMemo(() => new URLSearchParams(current.toString()), [current]);
  const set = useCallback(
    (next: Next, opts: { replace?: boolean } = {}) => {
      const qs = (next instanceof URLSearchParams ? next : new URLSearchParams(next)).toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (opts.replace === false) router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [router, pathname],
  );
  return [params, set];
}
