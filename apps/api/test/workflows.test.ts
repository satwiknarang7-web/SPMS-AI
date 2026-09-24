import { describe, expect, it } from 'vitest';
import { prisma } from '../src/core/db';
import { login } from './helpers';

describe('UAT: dispense an electronic prescription with a safety check', () => {
  it('receives an eRx token, raises the warfarin interaction, requires an intervention, dispenses, and updates stock and audit', async () => {
    const rx = await login('pharmacist@harbourside.demo');

    // Token for Margaret Chen (on warfarin) prescribing aspirin.
    const token = await rx.get('/api/dispense/erx/2GF7K9QXLM4T');
    expect(token.status).toBe(200);
    expect(token.body.patient.lastName).toBe('Chen');

    const search = await rx.get(`/api/dispense/drugs?q=${encodeURIComponent('Aspirin')}`);
    const pack = search.body[0].items.find((i: { onHand: number }) => i.onHand > 0) ?? search.body[0].items[0];

    const quote = await rx.post('/api/dispense/scripts/quote', { patientId: token.body.patientId, drugId: pack.drugId, productId: pack.productId, scriptType: 'PBS', quantity: token.body.quantity });
    expect(quote.body.requiresIntervention).toBe(true);
    expect(quote.body.alerts[0]).toMatchObject({ type: 'INTERACTION', severity: 'HIGH' });
    // Concession patient: co-payment capped at the concessional rate.
    expect(quote.body.price.patientPrice).toBeLessThanOrEqual(770);

    const created = await rx.post('/api/dispense/scripts', {
      patientId: token.body.patientId, prescriberId: token.body.prescriberId, drugId: pack.drugId, productId: pack.productId, scriptType: 'PBS', source: 'ERX_TOKEN',
      erxToken: token.body.token, prescribedDate: token.body.prescribedDate, directions: token.body.directions, quantity: token.body.quantity, repeatsTotal: token.body.repeats, brandSubstitution: true,
    });
    expect(created.status).toBe(200);
    // Token is now claimed.
    expect((await rx.get('/api/dispense/erx/2GF7K9QXLM4T')).status).toBe(409);

    const before = await prisma.storeProduct.findFirstOrThrow({ where: { productId: pack.productId, storeId: created.body.storeId } });

    const wrongScan = await rx.post(`/api/dispense/scripts/${created.body.id}/check`, { scannedBarcode: '0000000000000' });
    expect(wrongScan.status).toBe(422);

    const noIntervention = await rx.post(`/api/dispense/scripts/${created.body.id}/check`, { scannedBarcode: pack.barcode });
    expect(noIntervention.status).toBe(422);
    expect(noIntervention.body.error.message).toMatch(/intervention/i);

    const checked = await rx.post(`/api/dispense/scripts/${created.body.id}/check`, {
      scannedBarcode: pack.barcode,
      interventions: [{ alertType: 'INTERACTION', outcome: 'PRESCRIBER_CONTACTED', note: 'Discussed with Dr Park — low-dose aspirin intended, INR monitoring arranged.' }],
    });
    expect(checked.status).toBe(200);
    expect(checked.body.status).toBe('READY');

    const after = await prisma.storeProduct.findFirstOrThrow({ where: { productId: pack.productId, storeId: created.body.storeId } });
    expect(after.onHand).toBe(before.onHand - 1);

    const detail = await rx.get(`/api/dispense/scripts/${created.body.id}`);
    const actions = detail.body.auditTrail.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['script.create', 'script.scan_mismatch', 'script.dispense']));
    expect(detail.body.interventions).toHaveLength(1);
  });

  it('flags a penicillin allergy', async () => {
    const rx = await login('pharmacist@harbourside.demo');
    const token = await rx.get('/api/dispense/erx/3HD8P2WZRN6V');
    const search = await rx.get('/api/dispense/drugs?q=Amoxicillin');
    const pack = search.body[0].items[0];
    const quote = await rx.post('/api/dispense/scripts/quote', { patientId: token.body.patientId, drugId: pack.drugId, productId: pack.productId, scriptType: 'PBS', quantity: 20 });
    expect(quote.body.alerts.some((a: { type: string; severity: string }) => a.type === 'ALLERGY' && a.severity === 'HIGH')).toBe(true);
  });
});

describe('UAT: mixed-cart retail sale', () => {
  it('sells a ready script and a retail item, surcharges only the non-PBS portion, and reconciles stock and payment', async () => {
    const pos = await login('cashier@harbourside.demo');
    const { body: current } = await pos.get('/api/pos/shift/current?register=Register%201');
    let shiftId = current.shift?.id as string | undefined;
    if (!shiftId) shiftId = (await pos.post('/api/pos/shift/open', { register: 'Register 1', openingFloat: 20000 })).body.id;

    const ready = await pos.get('/api/pos/scripts/ready');
    const script = ready.body.find((s: { scriptType: string }) => s.scriptType === 'PBS');
    const hot = await pos.get('/api/pos/hotkeys');
    const item = hot.body.find((h: { name: string }) => h.name.startsWith('Panadol'));
    const stockBefore = await prisma.storeProduct.findFirstOrThrow({ where: { productId: item.id, storeId: script.storeId } });

    const quote = await pos.post('/api/pos/quote', { lines: [{ prescriptionId: script.id }, { productId: item.id, quantity: 2 }] });
    expect(quote.status).toBe(200);
    const { total, pbsTotal, nonPbsTotal } = quote.body.totals;
    expect(pbsTotal).toBe(script.patientPrice);

    const surcharge = Math.round((nonPbsTotal * 1.5) / 100);
    const sale = await pos.post('/api/pos/sales', { shiftId, lines: [{ prescriptionId: script.id }, { productId: item.id, quantity: 2 }], tenders: [{ type: 'EFTPOS', amount: total }] });
    expect(sale.status).toBe(200);
    expect(sale.body.surcharge).toBe(surcharge);
    expect(sale.body.sale.payments[0].amount).toBe(total + surcharge);
    expect(sale.body.sale.total).toBe(total + surcharge);
    expect(sale.body.sale.payments[0].reference).toMatch(/^TXN-/);

    const collected = await prisma.prescription.findUniqueOrThrow({ where: { id: script.id } });
    expect(collected.status).toBe('COLLECTED');
    const stockAfter = await prisma.storeProduct.findFirstOrThrow({ where: { productId: item.id, storeId: script.storeId } });
    expect(stockAfter.onHand).toBe(stockBefore.onHand - 2);

    // Card over-tender is refused; cash over-tender gives change.
    const over = await pos.post('/api/pos/sales', { shiftId, lines: [{ productId: item.id, quantity: 1 }], tenders: [{ type: 'EFTPOS', amount: 999999 }] });
    expect(over.status).toBe(422);
    const cash = await pos.post('/api/pos/sales', { shiftId, lines: [{ productId: item.id, quantity: 1 }], tenders: [{ type: 'CASH', amount: 5000 }] });
    expect(cash.body.change).toBeGreaterThan(0);
  });

  it('requires a manager override for below-cost discounts', async () => {
    const pos = await login('cashier@harbourside.demo');
    const { body: current } = await pos.get('/api/pos/shift/current?register=Register%201');
    const hot = await pos.get('/api/pos/hotkeys');
    const item = hot.body[0];
    const res = await pos.post('/api/pos/sales', { shiftId: current.shift.id, lines: [{ productId: item.id, quantity: 1, discount: item.price - 1 }], tenders: [{ type: 'CASH', amount: 100 }] });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/manager override/i);
  });
});

describe('UAT: HQ price publication, offline queueing and rollback', () => {
  it('applies a price at the targeted store only, queues offline stores, and rolls back exactly', async () => {
    const hq = await login('pricing@harbourside.demo');
    const stores = (await hq.get('/api/hq/stores')).body as { id: string; code: string; online: boolean }[];
    const cbd = stores.find((s) => s.code === 'HPG-001')!;
    const products = (await hq.get('/api/hq/retail/products?q=Berocca')).body;
    const product = products[0];

    const original = await prisma.storeProduct.findFirstOrThrow({ where: { storeId: cbd.id, productId: product.id } });
    const pub = await hq.post('/api/hq/retail/publish', { storeIds: [cbd.id], changes: [{ productId: product.id, retailPrice: product.masterRetailPrice + 100 }] });
    expect(pub.status).toBe(200);
    await hq.post('/api/hq/sync/run');
    const applied = await prisma.storeProduct.findFirstOrThrow({ where: { storeId: cbd.id, productId: product.id } });
    expect(applied.retailPrice).toBe(product.masterRetailPrice + 100);
    const other = await prisma.storeProduct.findFirstOrThrow({ where: { storeId: stores.find((s) => s.code === 'HPG-003')!.id, productId: product.id } });
    expect(other.retailPrice).not.toBe(product.masterRetailPrice + 100);

    // The inconsistency now shows against the HQ master (HQ-RP-03).
    const inc = await hq.get('/api/hq/retail/inconsistencies');
    expect(inc.body.some((r: { store: { id: string }; product: { id: string } }) => r.store.id === cbd.id && r.product.id === product.id)).toBe(true);

    const rb = await hq.post(`/api/hq/sync/publications/${pub.body.id}/rollback`);
    expect(rb.status).toBe(200);
    const restored = await prisma.storeProduct.findFirstOrThrow({ where: { storeId: cbd.id, productId: product.id } });
    expect(restored.retailPrice).toBe(original.retailPrice);

    // Newcastle is seeded offline: its delivery is queued with a retry note.
    const newcastle = stores.find((s) => s.code === 'HPG-004')!;
    expect(newcastle.online).toBe(false);
    const queued = await prisma.publicationTarget.findFirst({ where: { storeId: newcastle.id, status: 'QUEUED' } });
    expect(queued?.error).toMatch(/offline/i);
  });

  it('refuses dispense pricing rules that breach PBS limits', async () => {
    const hq = await login('pricing@harbourside.demo');
    const groups = (await hq.get('/api/hq/groups')).body;
    const res = await hq.post('/api/hq/pricing/rules', { name: 'Illegal', groupId: groups[0].id, condition: 'PBS', markupPct: 10, copayDiscount: 250 });
    expect(res.status).toBe(422);
    expect(res.body.error.details.violations.length).toBeGreaterThan(0);
  });
});

describe('audit trail', () => {
  it('has an intact hash chain after all the above activity', async () => {
    const owner = await login('owner@harbourside.demo');
    const res = await owner.get('/api/platform/audit/verify');
    expect(res.body.valid).toBe(true);
    expect(res.body.checked).toBeGreaterThan(5);
  });

  it('detects tampering', async () => {
    const owner = await login('owner@harbourside.demo');
    const me = await owner.get('/api/auth/me');
    const victim = await prisma.auditEvent.findFirstOrThrow({ where: { tenantId: me.body.tenant.id, action: 'script.dispense' } });
    await prisma.auditEvent.update({ where: { id: victim.id }, data: { summary: 'nothing to see here' } });
    const res = await owner.get('/api/platform/audit/verify');
    expect(res.body).toMatchObject({ valid: false, brokenAt: victim.id });
    await prisma.auditEvent.update({ where: { id: victim.id }, data: { summary: victim.summary } });
  });
});
