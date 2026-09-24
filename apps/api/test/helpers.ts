import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app';

export const PASSWORD = 'Segue2026!';

let app: FastifyInstance | null = null;
export async function getApp() {
  app ??= await buildApp({ logger: false });
  return app;
}

type Res<T> = { status: number; body: T; headers: LightMyRequestResponse['headers'] };

export interface Client {
  cookies: Map<string, string>;
  get: <T = any>(url: string) => Promise<Res<T>>;
  post: <T = any>(url: string, payload?: unknown) => Promise<Res<T>>;
  put: <T = any>(url: string, payload?: unknown) => Promise<Res<T>>;
  patch: <T = any>(url: string, payload?: unknown) => Promise<Res<T>>;
  delete: <T = any>(url: string) => Promise<Res<T>>;
}

/** Applies Set-Cookie headers to a jar (a cleared cookie is removed). */
export function absorbCookies(jar: Map<string, string>, res: LightMyRequestResponse) {
  for (const c of res.cookies) {
    if (!c.value || (c.maxAge !== undefined && c.maxAge <= 0) || (c.expires && new Date(c.expires) < new Date())) jar.delete(c.name);
    else jar.set(c.name, c.value);
  }
}

/** A cookie-jar client, like a browser tab. */
export async function client(jar = new Map<string, string>()): Promise<Client> {
  const a = await getApp();
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE') => async (url: string, payload?: unknown) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await a.inject({ method, url, headers: cookie ? { cookie } : {}, payload: payload as never });
    absorbCookies(jar, r);
    const isJson = String(r.headers['content-type'] ?? '').includes('json');
    return { status: r.statusCode, body: isJson ? r.json() : r.body, headers: r.headers };
  };
  return { cookies: jar, get: call('GET'), post: call('POST'), put: call('PUT'), patch: call('PATCH'), delete: call('DELETE') };
}

export async function login(email: string, password = PASSWORD): Promise<Client> {
  const c = await client();
  const res = await c.post('/api/auth/login', { email, password });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${JSON.stringify(res.body)}`);
  return c;
}
