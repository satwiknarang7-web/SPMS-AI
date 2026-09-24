import { describe, expect, it } from 'vitest';
import { prisma } from '../src/core/db';
import { client, getApp, login, PASSWORD } from './helpers';

describe('access and refresh tokens', () => {
  it('issues an httpOnly access cookie and a refresh cookie scoped to /api/auth', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'owner@harbourside.demo', password: PASSWORD } });
    expect(res.statusCode).toBe(200);
    const at = res.cookies.find((c) => c.name === 'segue_at')!;
    const rt = res.cookies.find((c) => c.name === 'segue_rt')!;
    expect(at).toMatchObject({ httpOnly: true, path: '/', sameSite: 'Lax' });
    expect(rt).toMatchObject({ httpOnly: true, path: '/api/auth', sameSite: 'Strict' });
    expect(at.maxAge).toBe(900);
    expect(res.json().accessTokenExpiresAt).toBeTruthy();
    // The refresh token is never stored in clear text.
    expect(await prisma.refreshToken.count({ where: { tokenHash: rt.value } })).toBe(0);
  });

  it('rotates the refresh token on every refresh', async () => {
    const c = await login('owner@harbourside.demo');
    const first = c.cookies.get('segue_rt');
    const r = await c.post('/api/auth/refresh');
    expect(r.status).toBe(200);
    expect(r.body.user.email).toBe('owner@harbourside.demo');
    expect(c.cookies.get('segue_rt')).not.toBe(first);
    expect((await c.get('/api/auth/me')).status).toBe(200);
  });

  it('treats reuse of a rotated refresh token as theft and revokes the session', async () => {
    const victim = await login('manager@harbourside.demo');
    const stolen = victim.cookies.get('segue_rt')!;
    expect((await victim.post('/api/auth/refresh')).status).toBe(200);

    // Attacker replays the old token.
    const attacker = await client(new Map([['segue_rt', stolen]]));
    const replay = await attacker.post('/api/auth/refresh');
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('SESSION_REVOKED');

    // The legitimate session is now dead too — both access and refresh.
    const me = await victim.get('/api/auth/me');
    expect(me.body.error.code).toBe('SESSION_REVOKED');
    expect((await victim.post('/api/auth/refresh')).status).toBe(401);
  });

  it('accepts a Bearer access token for non-browser clients', async () => {
    const c = await login('reports@harbourside.demo');
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${c.cookies.get('segue_at')}` } });
    expect(res.statusCode).toBe(200);
  });

  it('reports an expired access token distinctly so the client can refresh', async () => {
    const c = await login('owner@harbourside.demo');
    const app = await getApp();
    const claims = app.jwt.decode<{ sub: string; tid: string; sid: string; ses: string }>(c.cookies.get('segue_at')!)!;
    const expired = app.jwt.sign({ sub: claims.sub, tid: claims.tid, sid: claims.sid, ses: claims.ses }, { expiresIn: 1 });
    await new Promise((r) => setTimeout(r, 1100));
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${expired}` } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('TOKEN_EXPIRED');
    // …and the refresh token still gets a new one.
    expect((await c.post('/api/auth/refresh')).status).toBe(200);
  });

  it('logout revokes the session immediately, even for a copied access token', async () => {
    const c = await login('category@harbourside.demo');
    const copiedAccess = c.cookies.get('segue_at')!;
    expect((await c.post('/api/auth/logout')).status).toBe(200);
    expect(c.cookies.has('segue_at')).toBe(false);
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${copiedAccess}` } });
    expect(res.json().error.code).toBe('SESSION_REVOKED');
  });

  it('lists sessions and can sign out other devices', async () => {
    const phone = await login('pricing@harbourside.demo');
    const desk = await login('pricing@harbourside.demo');
    const list = await desk.get('/api/auth/sessions');
    expect(list.body.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    const out = await desk.post('/api/auth/logout-others');
    expect(out.body.revoked).toBeGreaterThanOrEqual(1);
    expect((await phone.get('/api/auth/me')).status).toBe(401);
    expect((await desk.get('/api/auth/me')).status).toBe(200);
  });

  it('signs a user out everywhere when an admin resets their password', async () => {
    const target = await login('pharmacist.parra@harbourside.demo');
    const admin = await login('owner@harbourside.demo');
    const users = await admin.get('/api/platform/users');
    const u = users.body.find((x: { email: string }) => x.email === 'pharmacist.parra@harbourside.demo');
    expect((await admin.patch(`/api/platform/users/${u.id}`, { password: 'New-password-2026' })).status).toBe(200);
    expect((await target.get('/api/auth/me')).body.error.code).toBe('SESSION_REVOKED');
    await admin.patch(`/api/platform/users/${u.id}`, { password: PASSWORD });
  });
});

describe('brute-force protection', () => {
  it('locks an account after repeated wrong passwords', async () => {
    const c = await client();
    for (let i = 0; i < 5; i++) {
      const r = await c.post('/api/auth/login', { email: 'pharmacist.gong@harbourside.demo', password: 'wrong-password' });
      expect(r.status).toBe(401);
    }
    const locked = await c.post('/api/auth/login', { email: 'pharmacist.gong@harbourside.demo', password: PASSWORD });
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('rate-limits sign-in attempts per IP and email', async () => {
    const c = await client();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await c.post('/api/auth/login', { email: 'nobody@nowhere.demo', password: 'x' })).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    const last = await c.post('/api/auth/login', { email: 'nobody@nowhere.demo', password: 'x' });
    expect(last.body.error.code).toBe('RATE_LIMITED');
    expect(last.headers['retry-after']).toBeTruthy();
  });

  it('sends rate-limit headers on API responses', async () => {
    const c = await login('owner@harbourside.demo');
    const res = await c.get('/api/auth/me');
    expect(res.headers['x-ratelimit-limit']).toBeTruthy();
    expect(Number(res.headers['x-ratelimit-remaining'])).toBeGreaterThan(0);
  });
});
