/**
 * Thin, typed wrapper over fetch. Tokens live in httpOnly cookies — never in JS-readable
 * storage — so an XSS bug cannot exfiltrate them. Requests go to /api, which Next.js rewrites
 * to the Segue API (same origin, so cookies flow without CORS).
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined | string[]>;

function withQuery(path: string, query?: Query) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Auth endpoints that must never trigger a refresh-and-retry. */
const NO_REFRESH = ['/auth/login', '/auth/refresh', '/auth/logout'];

let refreshing: Promise<boolean> | null = null;

/**
 * Exchange the refresh cookie for a new access token. Single-flight: concurrent 401s share one
 * refresh, because refresh tokens are single-use and a second parallel refresh would look like
 * token theft to the server.
 */
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      setTimeout(() => (refreshing = null), 0);
    });
  return refreshing;
}

async function send(method: string, path: string, body: unknown, query?: Query) {
  return fetch(`/api${withQuery(path, query)}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  let res = await send(method, path, body, query);
  // Access tokens are short-lived: on 401, refresh once and replay the request.
  if (res.status === 401 && !NO_REFRESH.includes(path) && (await refreshSession())) {
    res = await send(method, path, body, query);
  }
  if (res.status === 204) return undefined as T;
  const isJson = res.headers.get('content-type')?.includes('json');
  const payload = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const err = (payload as { error?: { code: string; message: string; details?: unknown } })?.error;
    const apiError = new ApiError(res.status, err?.code ?? 'ERROR', err?.message ?? res.statusText, err?.details);
    if (res.status === 401 && !NO_REFRESH.includes(path)) window.dispatchEvent(new CustomEvent('segue:unauthorised'));
    throw apiError;
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, undefined, query),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  delete: <T>(path: string) => request<T>('DELETE', path),
  url: (path: string, query?: Query) => `/api${withQuery(path, query)}`,
};

/** Human-readable message for any thrown error, including field-level validation details. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const d = err.details as { fieldErrors?: Record<string, string[]>; violations?: { message: string }[] } | undefined;
    const fields = d?.fieldErrors ? Object.entries(d.fieldErrors).map(([k, v]) => `${k}: ${v.join(', ')}`) : [];
    const violations = d?.violations?.map((v) => v.message) ?? [];
    return [err.message, ...fields, ...violations].join(' — ');
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}
