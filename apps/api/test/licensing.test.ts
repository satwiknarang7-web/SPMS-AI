import { describe, expect, it } from 'vitest';
import { getApp, login } from './helpers';

describe('module licensing is enforced by the API', () => {
  it('rejects unauthenticated requests', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/api/dispense/dashboard' });
    expect(res.statusCode).toBe(401);
  });

  it('blocks modules the tenant has not purchased, regardless of role', async () => {
    const corner = await login('owner@cornerchemist.demo');
    const me = await corner.get('/api/auth/me');
    expect(me.body.modules).toEqual(['DISPENSE', 'POS']);
    expect(me.body.permissions.some((p: string) => p.startsWith('office.'))).toBe(false);

    expect((await corner.get('/api/dispense/dashboard')).status).toBe(200);
    expect((await corner.get('/api/pos/hotkeys')).status).toBe(200);

    const office = await corner.get('/api/office/products');
    expect(office.status).toBe(403);
    expect(office.body.error.code).toBe('MODULE_NOT_LICENSED');
    const hq = await corner.get('/api/hq/dashboard');
    expect(hq.body.error.code).toBe('MODULE_NOT_LICENSED');
  });

  it('applies licence changes from the vendor console immediately', async () => {
    const vendor = await login('vendor@segue.demo');
    const corner = await login('owner@cornerchemist.demo');
    const tenants = await vendor.get('/api/vendor/tenants');
    const tenant = tenants.body.find((t: { name: string }) => t.name === 'Corner Chemist Katoomba');

    const renew = await vendor.put(`/api/vendor/tenants/${tenant.id}/subscriptions/OFFICE`, { status: 'ACTIVE', expiresAt: new Date(Date.now() + 86_400_000 * 30).toISOString() });
    expect(renew.status).toBe(200);
    expect((await corner.get('/api/office/products')).status).toBe(200);

    await vendor.put(`/api/vendor/tenants/${tenant.id}/subscriptions/OFFICE`, { status: 'SUSPENDED' });
    expect((await corner.get('/api/office/products')).body.error.code).toBe('MODULE_NOT_LICENSED');
  });

  it('keeps the vendor console away from pharmacy users', async () => {
    const owner = await login('owner@harbourside.demo');
    expect((await owner.get('/api/vendor/tenants')).status).toBe(403);
  });
});

describe('role-based access', () => {
  it('keeps retail staff out of clinical data', async () => {
    const cashier = await login('cashier@harbourside.demo');
    const res = await cashier.get('/api/dispense/patients');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect((await cashier.get('/api/pos/hotkeys')).status).toBe(200);
  });

  it('prevents technicians from final-checking a script', async () => {
    const tech = await login('tech@harbourside.demo');
    const queue = await tech.get('/api/dispense/scripts?status=AWAITING_CHECK');
    expect(queue.status).toBe(200);
    const res = await tech.post(`/api/dispense/scripts/${queue.body[0].id}/check`, { scannedBarcode: 'x' });
    expect(res.status).toBe(403);
  });

  it('stops store managers escalating privileges', async () => {
    const manager = await login('manager@harbourside.demo');
    const res = await manager.post('/api/platform/users', { name: 'Eve', email: 'eve@harbourside.demo', password: 'long-enough-pw', roles: [{ role: 'GROUP_ADMIN', storeId: null }] });
    expect(res.status).toBe(403);
  });
});
