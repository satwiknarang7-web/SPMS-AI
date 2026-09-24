/* eslint-disable no-console */
import { calculatePbsCharge, cardSurcharge, privateScriptPrice, validatePriceRows, type ConcessionType, type ModuleKey, type Role } from '@segue/shared';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { audit, systemActor } from '../src/core/audit';
import { prisma, tx } from '../src/core/db';
import { collectStoreMetrics } from '../src/jobs/metrics';
import { createPublication, runSync } from '../src/features/hq/sync/publication.service';
import { DRUGS, FIRST_NAMES, INTERACTIONS, LAST_NAMES, PRESCRIBERS, RETAIL } from './seed-data';

/** Deterministic PRNG so every reset produces the same demo data. */
function rng(seed: number) {
  let a = seed;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
    weighted: <T extends { weight: number }>(xs: readonly T[]): T => {
      const total = xs.reduce((s, x) => s + x.weight, 0);
      let r = next() * total;
      for (const x of xs) if ((r -= x.weight) <= 0) return x;
      return xs[xs.length - 1]!;
    },
    chance: (p: number) => next() < p,
  };
}
const R = rng(20260923);

const PASSWORD = 'Segue2026!';
const DAY = 86_400_000;
const daysAgo = (n: number, hour = 12, minute = 0) => {
  const d = new Date(Date.now() - n * DAY);
  d.setHours(hour, minute, R.int(0, 59), 0);
  return d;
};
let barcodeSeq = 1000;
const ean = (prefix: string) => {
  const body = `${prefix}${String(barcodeSeq++).padStart(12 - prefix.length, '0')}`;
  const sum = [...body].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return body + ((10 - (sum % 10)) % 10);
};
const chunk = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

async function createMany<T>(label: string, rows: T[], fn: (batch: T[]) => Promise<unknown>) {
  for (const batch of chunk(rows, 500)) await fn(batch);
  if (rows.length > 200) console.log(`  · ${rows.length.toLocaleString()} ${label}`);
}

interface TenantSpec {
  name: string;
  abn: string;
  modules: Partial<Record<ModuleKey, { status: string; expiresAt?: Date | null }>>;
  stores: { code: string; name: string; suburb: string; state: string; size: number }[];
  groups: { name: string; priority: number; description: string; stores: string[] }[];
  users: { email: string; name: string; roles: [Role, string | null][] }[];
  emailDomain: string;
}

async function main() {
  console.log('Seeding Segue demo data…');
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  await prisma.drugInteraction.createMany({ data: INTERACTIONS.map(([ingredientA, ingredientB, severity, description]) => ({ ingredientA, ingredientB, severity, description })) });
  await prisma.user.create({ data: { email: 'vendor@segue.demo', name: 'Segue Licensing Desk', passwordHash, isPlatformAdmin: true } });

  const harbourside = await seedTenant(passwordHash, {
    name: 'Harbourside Pharmacy Group',
    abn: '51 824 753 556',
    emailDomain: 'harbourside.demo',
    modules: { DISPENSE: { status: 'ACTIVE' }, POS: { status: 'ACTIVE' }, OFFICE: { status: 'ACTIVE' }, HQ: { status: 'ACTIVE' } },
    stores: [
      { code: 'HPG-001', name: 'Harbourside Sydney CBD', suburb: 'Sydney', state: 'NSW', size: 1.3 },
      { code: 'HPG-002', name: 'Harbourside Bondi Junction', suburb: 'Bondi Junction', state: 'NSW', size: 1.1 },
      { code: 'HPG-003', name: 'Harbourside Parramatta', suburb: 'Parramatta', state: 'NSW', size: 1.0 },
      { code: 'HPG-004', name: 'Harbourside Newcastle', suburb: 'Newcastle', state: 'NSW', size: 0.8 },
      { code: 'HPG-005', name: 'Harbourside Wollongong', suburb: 'Wollongong', state: 'NSW', size: 0.7 },
    ],
    groups: [
      { name: 'Harbourside Banner', priority: 5, description: 'Group-wide banner programme — highest precedence', stores: ['HPG-001', 'HPG-002', 'HPG-003', 'HPG-004', 'HPG-005'] },
      { name: 'Metro Sydney', priority: 10, description: 'Sydney metropolitan stores', stores: ['HPG-001', 'HPG-002', 'HPG-003'] },
      { name: 'Regional NSW', priority: 20, description: 'Hunter and Illawarra stores', stores: ['HPG-004', 'HPG-005'] },
    ],
    users: [
      { email: 'owner', name: 'Alex Morgan', roles: [['PHARMACIST', null], ['STORE_MANAGER', null], ['GROUP_ADMIN', null]] },
      { email: 'pharmacist', name: 'Priya Raman', roles: [['PHARMACIST', 'HPG-001']] },
      { email: 'tech', name: 'Liam Walker', roles: [['DISPENSARY_TECHNICIAN', 'HPG-001']] },
      { email: 'cashier', name: 'Chloe Martin', roles: [['PHARMACY_ASSISTANT', 'HPG-001']] },
      { email: 'manager', name: 'Daniel Kim', roles: [['STORE_MANAGER', 'HPG-001']] },
      { email: 'pricing', name: 'Olivia Brown', roles: [['PRICING_MANAGER', null]] },
      { email: 'category', name: 'Noah Patel', roles: [['CATEGORY_MANAGER', null]] },
      { email: 'reports', name: 'Grace Lee', roles: [['REPORTING_USER', null]] },
      { email: 'pharmacist.bondi', name: 'Marcus Webb', roles: [['PHARMACIST', 'HPG-002']] },
      { email: 'pharmacist.parra', name: 'Hannah Nguyen', roles: [['PHARMACIST', 'HPG-003']] },
      { email: 'pharmacist.newcastle', name: 'Ben Carter', roles: [['PHARMACIST', 'HPG-004']] },
      { email: 'pharmacist.gong', name: 'Isabella Russo', roles: [['PHARMACIST', 'HPG-005']] },
    ],
  });

  const corner = await seedTenant(passwordHash, {
    name: 'Corner Chemist Katoomba',
    abn: '73 615 280 941',
    emailDomain: 'cornerchemist.demo',
    // Dispense + POS licensed; Office subscription lapsed; HQ never purchased.
    modules: { DISPENSE: { status: 'ACTIVE' }, POS: { status: 'ACTIVE' }, OFFICE: { status: 'EXPIRED', expiresAt: new Date(Date.now() - 12 * DAY) } },
    stores: [{ code: 'CCK-001', name: 'Corner Chemist Katoomba', suburb: 'Katoomba', state: 'NSW', size: 0.6 }],
    groups: [],
    users: [{ email: 'owner', name: 'Sam Taylor', roles: [['PHARMACIST', null], ['STORE_MANAGER', null]] }],
  });

  await seedHq(harbourside);

  console.log('Collecting store metrics for HQ reporting…');
  await collectStoreMetrics({ days: 31 });
  await seedOlderMetrics(harbourside.tenantId);
  await seedOlderMetrics(corner.tenantId);

  await tx(async (db) => {
    for (const t of [harbourside, corner]) {
      await audit(db, systemActor(t.tenantId), { module: 'PLATFORM', action: 'seed', entityType: 'Tenant', entityId: t.tenantId, summary: 'Demo data loaded' });
    }
  });

  console.log('\nDone. Sign in with any of these (password: Segue2026!):');
  console.table([
    { email: 'owner@harbourside.demo', access: 'All four modules, all stores (pharmacist + manager + group admin)' },
    { email: 'pharmacist@harbourside.demo', access: 'Dispense (+ POS selling) at Sydney CBD' },
    { email: 'tech@harbourside.demo', access: 'Dispense preparation only — cannot final-check' },
    { email: 'cashier@harbourside.demo', access: 'POS only — no clinical access' },
    { email: 'manager@harbourside.demo', access: 'Office + POS management at Sydney CBD' },
    { email: 'pricing@harbourside.demo', access: 'HQ pricing, promotions, price files' },
    { email: 'reports@harbourside.demo', access: 'HQ read-only reporting' },
    { email: 'owner@cornerchemist.demo', access: 'Single store — Dispense + POS licensed, Office expired, no HQ' },
    { email: 'vendor@segue.demo', access: 'Segue licensing console (module subscriptions)' },
  ]);
}

/* ────────────────────────────── Tenant seeding ────────────────────────────── */

interface SeededTenant {
  tenantId: string;
  stores: { id: string; code: string; size: number }[];
  groups: Map<string, string>;
  users: Map<string, string>;
  ownerId: string;
  products: { id: string; name: string; category: string; cost: number; retail: number; weight: number; gstFree: boolean; barcode: string }[];
  drugProducts: { drugId: string; productId: string; cost: number; seed: (typeof DRUGS)[number] }[];
  supplierIds: string[];
}

async function seedTenant(passwordHash: string, spec: TenantSpec): Promise<SeededTenant> {
  console.log(`\n▸ ${spec.name}`);
  const tenant = await prisma.tenant.create({ data: { name: spec.name, abn: spec.abn, settings: JSON.stringify({ surchargePct: 1.5, marginThresholdPct: 20, loyaltyPointsPerDollar: 1 }) } });
  for (const [module, s] of Object.entries(spec.modules)) {
    await prisma.subscription.create({ data: { tenantId: tenant.id, module, status: s.status, expiresAt: s.expiresAt ?? new Date(Date.now() + 365 * DAY), startsAt: new Date(Date.now() - 400 * DAY) } });
  }
  const stores: SeededTenant['stores'] = [];
  for (const s of spec.stores) {
    const store = await prisma.store.create({ data: { tenantId: tenant.id, code: s.code, name: s.name, suburb: s.suburb, state: s.state, lastSeenAt: new Date(), createdAt: new Date(Date.now() - 500 * DAY) } });
    stores.push({ id: store.id, code: s.code, size: s.size });
  }
  const storeId = (code: string) => stores.find((s) => s.code === code)!.id;
  const groups = new Map<string, string>();
  for (const [i, g] of spec.groups.entries()) {
    const group = await prisma.storeGroup.create({
      data: { tenantId: tenant.id, name: g.name, description: g.description, priority: g.priority, createdAt: new Date(Date.now() - (300 - i) * DAY), members: { create: g.stores.map((c) => ({ storeId: storeId(c) })) } },
    });
    groups.set(g.name, group.id);
  }
  const users = new Map<string, string>();
  for (const u of spec.users) {
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id, email: `${u.email}@${spec.emailDomain}`, name: u.name, passwordHash,
        roles: { create: u.roles.map(([role, code]) => ({ role, storeId: code ? storeId(code) : null })) },
      },
    });
    users.set(u.email, user.id);
  }

  // Suppliers (fictional wholesalers).
  const supplierDefs = [
    { name: 'Pacific Pharma Wholesale', accountNo: 'PPW-40218', electronic: true, terms: '30 days EOM', contactName: 'Orders desk', email: 'orders@pacificpharma.example', phone: '1300 555 101' },
    { name: 'Southern Cross Medical Supply', accountNo: 'SCM-88213', electronic: true, terms: '14 days', contactName: 'Account manager', email: 'service@southerncross.example', phone: '1300 555 202' },
    { name: 'Blue Gum Consumer Health', accountNo: 'BG-1177', electronic: false, terms: '30 days', contactName: 'Rep — Kate', email: 'kate@bluegum.example', phone: '02 5550 3030' },
  ];
  const supplierIds: string[] = [];
  for (const s of supplierDefs) supplierIds.push((await prisma.supplier.create({ data: { ...s, tenantId: tenant.id } })).id);

  // Drug master + dispensary packs.
  const drugProducts: SeededTenant['drugProducts'] = [];
  let rxSku = 1;
  for (const d of DRUGS) {
    for (const [brand, cost, premium] of d.brands) {
      const drug = await prisma.drug.create({
        data: {
          tenantId: tenant.id, genericName: d.generic, brandName: brand, ingredient: d.ingredient, strength: d.strength, form: d.form, packSize: d.pack,
          drugClass: d.cls, schedule: d.schedule, pbsCode: d.pbs, dpmq: d.dpmq, brandPremium: premium ?? 0, maxQuantity: d.maxQty, maxRepeats: d.maxRepeats, minRepeatDays: d.minRepeatDays || null,
        },
      });
      const product = await prisma.product.create({
        data: {
          tenantId: tenant.id, sku: `RX-${String(rxSku++).padStart(4, '0')}`, barcode: ean('93'), name: `${brand} ${d.strength} ${d.form.toLowerCase()} ×${d.pack}`, brand,
          category: 'Prescription', department: 'DISPENSARY', drugId: drug.id, costPrice: cost, retailPrice: privateScriptPrice(cost), gstFree: true,
          suppliers: { create: { supplierId: supplierIds[drugProducts.length % 2]!, cost, isPrimary: true, supplierCode: `D${String(rxSku).padStart(5, '0')}` } },
        },
      });
      drugProducts.push({ drugId: drug.id, productId: product.id, cost, seed: d });
    }
  }

  // Front-shop range.
  const products: SeededTenant['products'] = [];
  let fsSku = 1;
  for (const p of RETAIL) {
    const barcode = ean('94');
    const product = await prisma.product.create({
      data: {
        tenantId: tenant.id, sku: `FS-${String(fsSku++).padStart(4, '0')}`, barcode, name: p.name, brand: p.brand, category: p.category, department: 'FRONT_SHOP',
        costPrice: p.cost, retailPrice: p.retail, gstFree: p.gstFree ?? false, hotkeyColor: p.hotkey ?? null,
        suppliers: { create: { supplierId: supplierIds[p.category.startsWith('Vitamins') || p.category === 'Skin Care' ? 2 : 1]!, cost: p.cost, isPrimary: true, supplierCode: `R${String(fsSku).padStart(5, '0')}` } },
      },
    });
    products.push({ id: product.id, name: p.name, category: p.category, cost: p.cost, retail: p.retail, weight: p.weight, gstFree: p.gstFree ?? false, barcode });
  }

  // Stock positions at every store.
  const storeProducts = stores.flatMap((s) => [
    ...drugProducts.map((d) => ({ storeId: s.id, productId: d.productId, onHand: R.chance(0.08) ? 0 : R.int(2, 24), reorderPoint: 3, reorderQty: 10 })),
    ...products.map((p) => ({ storeId: s.id, productId: p.id, onHand: R.chance(0.05) ? 0 : R.int(3, 48), reorderPoint: R.int(4, 8), reorderQty: R.int(12, 24) })),
  ]);
  await createMany('stock positions', storeProducts, (b) => prisma.storeProduct.createMany({ data: b }));

  // Prescribers & patients.
  const prescriberIds: string[] = [];
  for (const [name, prescriberNo, type, practice] of PRESCRIBERS) prescriberIds.push((await prisma.prescriber.create({ data: { tenantId: tenant.id, name, prescriberNo, type, practice } })).id);

  const keyPatients = [
    { firstName: 'Margaret', lastName: 'Chen', dob: new Date('1948-03-14'), concessionType: 'CONCESSION', concessionNo: '312 456 789A', allergies: [], alerts: ['On warfarin — check INR history before any new antiplatelet or antibiotic'], phone: '0412 555 101' },
    { firstName: 'James', lastName: "O'Brien", dob: new Date('1979-11-02'), concessionType: 'GENERAL', allergies: [{ substance: 'Penicillin', reaction: 'Anaphylaxis', severity: 'SEVERE' }], alerts: [], phone: '0423 555 202' },
    { firstName: 'Sophie', lastName: 'Williams', dob: new Date('1991-06-21'), concessionType: 'GENERAL', allergies: [{ substance: 'Sulfonamides', reaction: 'Rash', severity: 'MODERATE' }], alerts: [], phone: '0434 555 303' },
    { firstName: 'Robert', lastName: 'Nguyen', dob: new Date('1952-01-30'), concessionType: 'DVA', concessionNo: 'NX123456', allergies: [], alerts: ['Hard of hearing — face patient when counselling'], phone: '0445 555 404' },
    { firstName: 'Emily', lastName: 'Taylor', dob: new Date('2001-09-09'), concessionType: 'GENERAL', allergies: [], alerts: [], phone: '0456 555 505' },
    { firstName: 'William', lastName: 'Smith', dob: new Date('1944-12-25'), concessionType: 'CONCESSION', concessionNo: '401 223 998B', allergies: [{ substance: 'Codeine', reaction: 'Nausea and vomiting', severity: 'MILD' }], alerts: [], phone: '0467 555 606', safetyNetTotal: 29880 },
  ];
  const patientIds: string[] = [];
  const patientConcession = new Map<string, ConcessionType>();
  for (const p of keyPatients) {
    const created = await prisma.patient.create({
      data: {
        tenantId: tenant.id, firstName: p.firstName, lastName: p.lastName, dob: p.dob, concessionType: p.concessionType, concessionNo: p.concessionNo, phone: p.phone,
        medicareNo: `${R.int(2000, 6999)}${R.int(10000, 99999)}${R.int(1, 9)}`, allergies: JSON.stringify(p.allergies), alerts: JSON.stringify(p.alerts),
        safetyNetTotal: p.safetyNetTotal ?? R.int(2000, 40000), address: `${R.int(1, 200)} ${R.pick(['George', 'Pitt', 'King', 'Oxford', 'Church', 'Victoria'])} St`,
      },
    });
    patientIds.push(created.id);
    patientConcession.set(created.id, p.concessionType as ConcessionType);
  }
  for (let i = 0; i < 54; i++) {
    const concession = R.chance(0.35) ? 'CONCESSION' : R.chance(0.05) ? 'DVA' : 'GENERAL';
    const created = await prisma.patient.create({
      data: {
        tenantId: tenant.id, firstName: R.pick(FIRST_NAMES), lastName: R.pick(LAST_NAMES), dob: new Date(Date.now() - R.int(18, 90) * 365.25 * DAY),
        concessionType: concession, medicareNo: `${R.int(2000, 6999)}${R.int(10000, 99999)}${R.int(1, 9)}`, phone: `04${R.int(10, 99)} 555 ${R.int(100, 999)}`,
        allergies: JSON.stringify(R.chance(0.15) ? [{ substance: R.pick(['Penicillin', 'Sulfonamides', 'Aspirin', 'Codeine', 'Cephalosporin']), reaction: R.pick(['Rash', 'Hives', 'Swelling']), severity: R.pick(['MILD', 'MODERATE']) }] : []),
        safetyNetTotal: R.int(0, concession === 'GENERAL' ? 90000 : 20000),
      },
    });
    patientIds.push(created.id);
    patientConcession.set(created.id, concession as ConcessionType);
  }

  // Customers: loyalty members and account customers (two linked to patients).
  const customers = [
    { name: 'Margaret Chen', hasAccount: true, creditLimit: 50000, balance: 8640, patientId: patientIds[0], accountFee: 0 },
    { name: 'Robert Nguyen', hasAccount: true, creditLimit: 30000, balance: 2210, patientId: patientIds[3], accountFee: 0 },
    { name: 'Blue Mountains Aged Care', hasAccount: true, creditLimit: 500000, balance: 184320, accountFee: 1500 },
    { name: 'Coastal Physio Clinic', hasAccount: true, creditLimit: 100000, balance: 0, accountFee: 500 },
    ...Array.from({ length: 12 }, () => ({ name: `${R.pick(FIRST_NAMES)} ${R.pick(LAST_NAMES)}`, hasAccount: false, creditLimit: 0, balance: 0, accountFee: 0 })),
  ];
  const customerIds: string[] = [];
  for (const c of customers) {
    const created = await prisma.customer.create({
      data: { tenantId: tenant.id, name: c.name, hasAccount: c.hasAccount, creditLimit: c.creditLimit, balance: c.balance, accountFee: c.accountFee, patientId: 'patientId' in c ? c.patientId : null, loyaltyNo: `SL${R.int(10000000, 99999999)}`, points: R.int(0, 2400), phone: `04${R.int(10, 99)} 555 ${R.int(100, 999)}`, email: `${c.name.split(' ')[0]!.toLowerCase()}@example.com` },
    });
    customerIds.push(created.id);
    if (c.balance) await prisma.accountTransaction.create({ data: { customerId: created.id, type: 'CHARGE', amount: c.balance, note: 'Opening balance' } });
  }

  // Equipment hire fleet.
  for (const s of stores) {
    const fleet = [
      ['Crutches', 'Adjustable aluminium crutches (pair)', 800, 5000], ['Crutches', 'Adjustable aluminium crutches (pair)', 800, 5000],
      ['Wheelchair', 'Folding transit wheelchair', 2500, 15000], ['Nebuliser', 'Compressor nebuliser', 1500, 10000],
      ['Breast pump', 'Hospital-grade breast pump', 2000, 15000], ['Vaporiser', 'Steam vaporiser', 900, 4000],
    ] as const;
    for (const [i, [group, name, weeklyRate, deposit]] of fleet.entries()) {
      await prisma.hireItem.create({ data: { storeId: s.id, group, name, serial: `${s.code.slice(0, 3)}-${group.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(3, '0')}`, weeklyRate, deposit } });
    }
  }

  const seeded: SeededTenant = { tenantId: tenant.id, stores, groups, users, ownerId: users.get('owner')!, products, drugProducts, supplierIds };
  await seedHistory(seeded, patientIds, patientConcession, prescriberIds, customerIds, spec);
  return seeded;
}

/* ─────────────────────────── 30 days of trading history ─────────────────────────── */

async function seedHistory(t: SeededTenant, patientIds: string[], concessionOf: Map<string, ConcessionType>, prescriberIds: string[], customerIds: string[], spec: TenantSpec) {
  const pharmacistFor = (code: string) => {
    const email = spec.users.find((u) => u.roles.some(([r, c]) => r === 'PHARMACIST' && c === code))?.email ?? 'owner';
    return t.users.get(email)!;
  };
  const cashierId = t.users.get('cashier') ?? t.ownerId;
  const techId = t.users.get('tech') ?? t.ownerId;
  const now = new Date();

  for (const store of t.stores) {
    const shifts: object[] = [];
    const sales: object[] = [];
    const lines: object[] = [];
    const payments: object[] = [];
    const scripts: object[] = [];
    let saleNo = 0;
    let rxNo = 0;
    const pharmacistId = pharmacistFor(store.code);

    for (let day = 30; day >= 0; day--) {
      const shiftId = randomUUID();
      const openedAt = daysAgo(day, 8, 30);
      const isToday = day === 0;
      let cashTaken = 0;
      const lastHour = isToday ? Math.max(9, now.getHours() - 1) : 18;
      if (isToday && now.getHours() < 9) continue;

      // Dispensed scripts (most collected through POS in the same visit).
      const rxCount = Math.round(R.int(22, 40) * store.size * (isToday ? (lastHour - 8) / 10 : 1));
      for (let i = 0; i < rxCount; i++) {
        const dp = R.weighted(t.drugProducts.map((d) => ({ ...d, weight: d.seed.weight / d.seed.brands.length })));
        const patientId = R.pick(patientIds.slice(6));
        const concession = concessionOf.get(patientId)!;
        const scriptType = concession === 'DVA' ? 'RPBS' : R.chance(0.82) ? 'PBS' : 'PRIVATE';
        const quantity = dp.seed.maxQty;
        let patientPrice: number;
        let govt = 0;
        if (scriptType === 'PRIVATE' || !dp.seed.dpmq) patientPrice = privateScriptPrice(dp.cost * Math.ceil(quantity / dp.seed.pack));
        else {
          const c = calculatePbsCharge({ scriptType, concession, dpmq: dp.seed.dpmq, safetyNetReached: false, brandPremium: 0 });
          patientPrice = c.patientCharge;
          govt = c.governmentContribution;
        }
        const at = daysAgo(day, R.int(9, lastHour), R.int(0, 59));
        const id = randomUUID();
        rxNo++;
        const collectedSaleId = randomUUID();
        scripts.push({
          id, tenantId: t.tenantId, storeId: store.id, number: `RX${String(rxNo).padStart(7, '0')}`, patientId, prescriberId: R.pick(prescriberIds), drugId: dp.drugId, productId: dp.productId,
          scriptType, source: R.chance(0.7) ? 'ERX_TOKEN' : 'PAPER', prescribedDate: new Date(at.getTime() - R.int(0, 20) * DAY), directions: directionsFor(dp.seed.form),
          quantity, repeatsTotal: dp.seed.maxRepeats, status: 'COLLECTED', patientPrice, governmentContribution: govt, safetyNetContribution: scriptType === 'PRIVATE' ? 0 : patientPrice,
          pricingBasis: scriptType === 'PRIVATE' ? 'Private — default store pricing' : 'PBS', scanVerified: R.chance(0.96), preparedById: pharmacistId, checkedById: pharmacistId,
          dispensedAt: at, collectedAt: new Date(at.getTime() + R.int(5, 90) * 60_000), saleId: collectedSaleId, createdAt: at, updatedAt: at,
        });
        saleNo++;
        const extra = R.chance(0.35) ? R.weighted(t.products) : null;
        const scriptLine = { id: randomUUID(), saleId: collectedSaleId, prescriptionId: id, description: `Rx ${String(rxNo).padStart(7, '0')} · ${dp.seed.generic}`, quantity: 1, unitPrice: patientPrice, unitCost: 0, lineTotal: patientPrice, gstFree: true, isPbs: scriptType !== 'PRIVATE' };
        const extraLine = extra ? { id: randomUUID(), saleId: collectedSaleId, productId: extra.id, description: extra.name, quantity: 1, unitPrice: extra.retail, unitCost: extra.cost, lineTotal: extra.retail, gstFree: extra.gstFree, isPbs: false } : null;
        const total0 = patientPrice + (extra?.retail ?? 0);
        const card = R.chance(0.65);
        const surcharge = card ? cardSurcharge(total0, extra?.retail ?? 0, 1.5) : 0;
        const total = total0 + surcharge;
        sales.push({
          id: collectedSaleId, storeId: store.id, shiftId, number: `S${String(saleNo).padStart(7, '0')}`, subtotal: total0, discountTotal: 0, surcharge,
          gst: extra && !extra.gstFree ? Math.round(extra.retail / 11) : 0, total, cashierId, createdAt: new Date(at.getTime() + 10 * 60_000),
        });
        lines.push(scriptLine, ...(extraLine ? [extraLine] : []));
        payments.push({ id: randomUUID(), saleId: collectedSaleId, tender: card ? 'EFTPOS' : 'CASH', amount: total, reference: card ? `TXN-${randomUUID().slice(0, 10).toUpperCase()}` : null });
        if (!card) cashTaken += total;
      }

      // Retail-only transactions.
      const retailCount = Math.round(R.int(35, 60) * store.size * (isToday ? (lastHour - 8) / 10 : 1));
      for (let i = 0; i < retailCount; i++) {
        const saleId = randomUUID();
        const at = daysAgo(day, R.int(8, lastHour), R.int(0, 59));
        const items = Array.from({ length: R.int(1, 3) }, () => R.weighted(t.products));
        let subtotal = 0;
        let gst = 0;
        let discountTotal = 0;
        for (const p of items) {
          const qty = R.chance(0.15) ? 2 : 1;
          const discount = R.chance(0.05) ? Math.round(p.retail * qty * 0.1) : 0;
          const lt = p.retail * qty - discount;
          subtotal += p.retail * qty;
          discountTotal += discount;
          if (!p.gstFree) gst += Math.round(lt / 11);
          lines.push({ id: randomUUID(), saleId, productId: p.id, description: p.name, quantity: qty, unitPrice: p.retail, unitCost: p.cost, discount, lineTotal: lt, gstFree: p.gstFree, isPbs: false });
        }
        const net = subtotal - discountTotal;
        const card = R.chance(0.7);
        const surcharge = card ? cardSurcharge(net, net, 1.5) : 0;
        saleNo++;
        const customerId = R.chance(0.25) ? R.pick(customerIds.slice(4)) : null;
        sales.push({ id: saleId, storeId: store.id, shiftId, number: `S${String(saleNo).padStart(7, '0')}`, customerId, subtotal, discountTotal, surcharge, gst, total: net + surcharge, cashierId, createdAt: at });
        payments.push({ id: randomUUID(), saleId, tender: card ? 'EFTPOS' : 'CASH', amount: net + surcharge, reference: card ? `TXN-${randomUUID().slice(0, 10).toUpperCase()}` : null });
        if (!card) cashTaken += net + surcharge;
      }

      const expected = 20000 + cashTaken;
      shifts.push(
        isToday
          ? { id: shiftId, storeId: store.id, register: 'Register 1', openedById: cashierId, openedAt, openingFloat: 20000, status: 'OPEN' }
          : { id: shiftId, storeId: store.id, register: 'Register 1', openedById: cashierId, openedAt, openingFloat: 20000, closedAt: daysAgo(day, 18, 30), closedById: cashierId, expectedCash: expected, countedCash: expected + (R.chance(0.2) ? R.int(-500, 300) : 0), status: 'CLOSED' },
      );
    }

    // Work in progress today at every store: ready for pickup, awaiting check, in progress.
    const queue: [status: string, n: number][] = [['READY', 4], ['AWAITING_CHECK', 2], ['IN_PROGRESS', 1]];
    for (const [status, n] of queue) {
      for (let i = 0; i < n; i++) {
        const dp = R.pick(t.drugProducts);
        const patientId = R.pick(patientIds.slice(6));
        const concession = concessionOf.get(patientId)!;
        const c = dp.seed.dpmq ? calculatePbsCharge({ scriptType: 'PBS', concession, dpmq: dp.seed.dpmq, safetyNetReached: false }) : null;
        rxNo++;
        const at = new Date(now.getTime() - R.int(10, 120) * 60_000);
        scripts.push({
          id: randomUUID(), tenantId: t.tenantId, storeId: store.id, number: `RX${String(rxNo).padStart(7, '0')}`, patientId, prescriberId: R.pick(prescriberIds), drugId: dp.drugId, productId: dp.productId,
          scriptType: c ? 'PBS' : 'PRIVATE', source: 'ERX_TOKEN', prescribedDate: new Date(at.getTime() - 2 * DAY), directions: directionsFor(dp.seed.form), quantity: dp.seed.maxQty, repeatsTotal: dp.seed.maxRepeats,
          status, patientPrice: c?.patientCharge ?? privateScriptPrice(dp.cost), governmentContribution: c?.governmentContribution ?? 0, safetyNetContribution: c?.patientCharge ?? 0, pricingBasis: c ? 'General co-payment' : 'Private — default store pricing',
          preparedById: status === 'READY' ? pharmacistId : techId, checkedById: status === 'READY' ? pharmacistId : null, dispensedAt: status === 'READY' ? at : null, scanVerified: status === 'READY', createdAt: at, updatedAt: at,
        });
      }
    }

    await createMany('shifts', shifts, (b) => prisma.shift.createMany({ data: b as never }));
    await createMany('prescriptions', scripts, (b) => prisma.prescription.createMany({ data: b as never }));
    await createMany('sales', sales, (b) => prisma.sale.createMany({ data: b as never }));
    await createMany('sale lines', lines, (b) => prisma.saleLine.createMany({ data: b as never }));
    await createMany('payments', payments, (b) => prisma.payment.createMany({ data: b as never }));
    console.log(`  ✓ ${store.code}: ${saleNo.toLocaleString()} sales, ${rxNo.toLocaleString()} scripts`);
  }

  // Clinical history for the scenario patients at the first store (drives safety alerts).
  const first = t.stores[0]!;
  const byGeneric = (g: string, brandIndex = 1) => {
    const matches = t.drugProducts.filter((d) => d.seed.generic === g);
    return matches[Math.min(brandIndex, matches.length - 1)]!;
  };
  const history: [patientIdx: number, generic: string, daysBack: number][] = [
    [0, 'Warfarin', 20], [0, 'Atorvastatin', 20], [0, 'Metoprolol', 45],
    [2, 'Sertraline', 15], [3, 'Clopidogrel', 12], [3, 'Perindopril', 12], [5, 'Levothyroxine', 25], [5, 'Metformin', 25],
  ];
  const count = await prisma.prescription.count({ where: { storeId: first.id } });
  for (const [i, [pi, generic, back]] of history.entries()) {
    const dp = byGeneric(generic);
    const at = daysAgo(back, 11);
    const pid = patientIds[pi]!;
    const c = calculatePbsCharge({ scriptType: concessionOf.get(pid) === 'DVA' ? 'RPBS' : 'PBS', concession: concessionOf.get(pid)!, dpmq: dp.seed.dpmq!, safetyNetReached: false });
    await prisma.prescription.create({
      data: {
        tenantId: t.tenantId, storeId: first.id, number: `RX${String(count + i + 1).padStart(7, '0')}`, patientId: pid, prescriberId: prescriberIds[0]!, drugId: dp.drugId, productId: dp.productId,
        scriptType: concessionOf.get(pid) === 'DVA' ? 'RPBS' : 'PBS', source: 'PAPER', prescribedDate: new Date(at.getTime() - 3 * DAY), directions: directionsFor(dp.seed.form), quantity: dp.seed.maxQty,
        repeatsTotal: dp.seed.maxRepeats, status: 'COLLECTED', patientPrice: c.patientCharge, governmentContribution: c.governmentContribution, safetyNetContribution: c.patientCharge, pricingBasis: c.basis,
        scanVerified: true, preparedById: pharmacistFor(first.code), checkedById: pharmacistFor(first.code), dispensedAt: at, collectedAt: at, createdAt: at,
      },
    });
  }

  // Electronic prescription tokens waiting on the (simulated) national exchange.
  const tokens: [patientIdx: number, generic: string, type: string, repeats: number][] = [
    [0, 'Aspirin', 'PBS', 5], [1, 'Amoxicillin', 'PBS', 0], [2, 'Tramadol', 'PBS', 0], [3, 'Esomeprazole', 'RPBS', 5], [4, 'Doxycycline', 'PBS', 1], [5, 'Rosuvastatin', 'PBS', 5], [4, 'Salbutamol', 'PBS', 2],
  ];
  const codes = ['2GF7K9QXLM4T', '3HD8P2WZRN6V', '4JK2M7XQTB9C', '5LP3N8YRVC2D', '6MQ4R9ZSWD3F', '7NR5S2AXTF4G', '8PS6T3BYUG5H'];
  for (const [i, [pi, generic, type, repeats]] of tokens.entries()) {
    const d = byGeneric(generic, 0);
    await prisma.erxToken.create({
      data: {
        token: spec.emailDomain === 'harbourside.demo' ? codes[i]! : `CC${codes[i]!.slice(2)}`, tenantId: t.tenantId, patientId: patientIds[pi]!, prescriberId: prescriberIds[i % prescriberIds.length]!,
        drugId: d.drugId, scriptType: type, directions: directionsFor(d.seed.form), quantity: d.seed.maxQty, repeats, prescribedDate: daysAgo(R.int(0, 3), 10),
      },
    });
  }

  // Purchasing: one order awaiting delivery, one draft.
  const low = await prisma.storeProduct.findMany({ where: { storeId: first.id, product: { department: 'FRONT_SHOP' } }, include: { product: true }, orderBy: { onHand: 'asc' }, take: 10 });
  await prisma.purchaseOrder.create({
    data: {
      storeId: first.id, number: 'PO000001', supplierId: t.supplierIds[1]!, status: 'SUBMITTED', source: 'REORDER', createdById: t.users.get('manager') ?? t.ownerId, submittedAt: daysAgo(1, 15), expectedAt: new Date(),
      lines: { create: low.slice(0, 5).map((sp) => ({ productId: sp.productId, qtyOrdered: 12, unitCost: sp.product.costPrice })) },
    },
  });
  await prisma.purchaseOrder.create({
    data: {
      storeId: first.id, number: 'PO000002', supplierId: t.supplierIds[2]!, status: 'DRAFT', source: 'MANUAL', createdById: t.users.get('manager') ?? t.ownerId,
      lines: { create: low.slice(5, 9).map((sp) => ({ productId: sp.productId, qtyOrdered: 6, unitCost: sp.product.costPrice })) },
    },
  });

  // An active layby and an active hire contract.
  const openShift = await prisma.shift.findFirst({ where: { storeId: first.id, status: 'OPEN' } });
  const layItems = t.products.filter((p) => p.category === 'Vitamins & Supplements').slice(0, 2);
  const layTotal = layItems.reduce((s, p) => s + p.retail, 0);
  await prisma.layby.create({
    data: { storeId: first.id, number: 'LB00001', customerId: customerIds[5]!, total: layTotal, paid: Math.round(layTotal * 0.3), dueDate: new Date(Date.now() + 40 * DAY), items: JSON.stringify(layItems.map((p) => ({ productId: p.id, description: p.name, quantity: 1, unitPrice: p.retail }))), payments: JSON.stringify([{ amount: Math.round(layTotal * 0.3), at: daysAgo(6) }]), createdAt: daysAgo(6) },
  });
  const wheelchair = await prisma.hireItem.findFirst({ where: { storeId: first.id, group: 'Wheelchair' } });
  if (wheelchair && openShift) {
    await prisma.hireContract.create({ data: { storeId: first.id, number: 'HC00001', hireItemId: wheelchair.id, customerId: customerIds[6]!, startDate: daysAgo(9), dueDate: new Date(Date.now() + 5 * DAY), depositPaid: wheelchair.deposit } });
    await prisma.hireItem.update({ where: { id: wheelchair.id }, data: { status: 'ON_HIRE' } });
  }
}

function directionsFor(form: string) {
  if (form.includes('Inhaler')) return 'Inhale 2 puffs when required for shortness of breath';
  if (form.includes('Pen')) return 'Inject subcutaneously as directed by your doctor';
  return R.pick(['Take ONE tablet daily', 'Take ONE tablet twice daily with food', 'Take ONE capsule three times daily until finished', 'Take ONE tablet at night', 'Take ONE to TWO tablets every 4–6 hours when required for pain (max 8 per day)']);
}

/* ──────────────────────────────── HQ configuration ──────────────────────────────── */

async function seedHq(t: SeededTenant) {
  console.log('\n▸ HQ configuration for Harbourside');
  const banner = t.groups.get('Harbourside Banner')!;
  const metro = t.groups.get('Metro Sydney')!;
  const regional = t.groups.get('Regional NSW')!;
  const pricingUser = t.users.get('pricing')!;
  const allStores = t.stores.map((s) => s.id);
  const membersOf = async (groupId: string) => (await prisma.storeGroupMember.findMany({ where: { groupId } })).map((m) => m.storeId);

  const rules = [
    { name: 'Banner private scripts', groupId: banner, condition: 'PRIVATE', drugClass: null, markupPct: 30, dispensingFee: 850, copayDiscount: 0, minMarginPct: 25 },
    { name: 'Banner PBS $1 co-payment discount', groupId: banner, condition: 'PBS', drugClass: null, markupPct: 0, dispensingFee: 0, copayDiscount: 100, minMarginPct: 0 },
    { name: 'Regional private scripts', groupId: regional, condition: 'PRIVATE', drugClass: null, markupPct: 25, dispensingFee: 750, copayDiscount: 0, minMarginPct: 20 },
    { name: 'Metro statin private pricing', groupId: metro, condition: 'PRIVATE', drugClass: 'Statin', markupPct: 20, dispensingFee: 600, copayDiscount: 0, minMarginPct: 15 },
  ];
  for (const r of rules) {
    const rule = await prisma.dispensePricingRule.create({ data: { ...r, tenantId: t.tenantId, status: 'SCHEDULED', createdAt: daysAgo(40) } });
    const pub = await createPublication(prisma, { tenantId: t.tenantId, kind: 'DISPENSE_PRICING', title: `Dispense pricing: ${r.name}`, payload: { ruleId: rule.id }, storeIds: await membersOf(r.groupId), createdById: pricingUser });
    await prisma.dispensePricingRule.update({ where: { id: rule.id }, data: { publicationId: pub.id, effectiveAt: pub.effectiveAt } });
  }

  await createPublication(prisma, { tenantId: t.tenantId, kind: 'DRUG_CONFIG', title: 'Drug configuration: Metro Sydney (highest margin)', payload: { groupId: metro, basis: 'HIGHEST_MARGIN', flags: [] }, storeIds: await membersOf(metro), createdById: t.users.get('category')! });
  await createPublication(prisma, { tenantId: t.tenantId, kind: 'DRUG_CONFIG', title: 'Drug configuration: Regional NSW (stock on hand)', payload: { groupId: regional, basis: 'STOCK_ON_HAND', flags: [] }, storeIds: await membersOf(regional), createdById: t.users.get('category')! });
  const drugId = async (brand: string) => (await prisma.drug.findFirstOrThrow({ where: { tenantId: t.tenantId, brandName: brand } })).id;
  await createPublication(prisma, {
    tenantId: t.tenantId, kind: 'DRUG_CONFIG', title: 'Drug configuration: Harbourside Banner, 3 flag changes',
    payload: { groupId: banner, basis: null, flags: [{ drugId: await drugId('APO-Rosuvastatin'), flag: 'PREFERRED' }, { drugId: await drugId('Nexium'), flag: 'RESTRICTED' }, { drugId: await drugId('Clamoxyl Duo Forte'), flag: 'EXCLUDED' }] },
    storeIds: allStores, createdById: t.users.get('category')!,
  });

  const vitamins = t.products.filter((p) => p.category === 'Vitamins & Supplements').map((p) => p.id);
  const winter = await prisma.promotion.create({ data: { tenantId: t.tenantId, name: 'Winter Wellness — 20% off vitamins', type: 'PERCENT_OFF', value: 20, productIds: JSON.stringify(vitamins), storeIds: JSON.stringify(allStores), startsAt: daysAgo(5, 0), endsAt: new Date(Date.now() + 21 * DAY) } });
  const wp = await createPublication(prisma, { tenantId: t.tenantId, kind: 'PROMOTION', title: `Promotion: ${winter.name}`, payload: { promotionId: winter.id }, storeIds: allStores, createdById: pricingUser });
  await prisma.promotion.update({ where: { id: winter.id }, data: { publicationId: wp.id } });
  const nurofen = t.products.filter((p) => p.name.startsWith('Nurofen')).map((p) => p.id);
  const metroStores = await membersOf(metro);
  const nuro = await prisma.promotion.create({ data: { tenantId: t.tenantId, name: 'Nurofen $2 off (Metro)', type: 'AMOUNT_OFF', value: 200, productIds: JSON.stringify(nurofen), storeIds: JSON.stringify(metroStores), startsAt: daysAgo(2, 0), endsAt: new Date(Date.now() + 12 * DAY) } });
  const np = await createPublication(prisma, { tenantId: t.tenantId, kind: 'PROMOTION', title: `Promotion: ${nuro.name}`, payload: { promotionId: nuro.id }, storeIds: metroStores, createdById: pricingUser });
  await prisma.promotion.update({ where: { id: nuro.id }, data: { publicationId: np.id } });

  const sync1 = await runSync({ tenantId: t.tenantId, force: true });
  console.log(`  · published and applied ${sync1.applied} store deliveries`);

  // Local store price overrides that now differ from the HQ master (HQ-RP-03 demo).
  const bondi = t.stores.find((s) => s.code === 'HPG-002')!.id;
  const newcastle = t.stores.find((s) => s.code === 'HPG-004')!.id;
  for (const [storeId, factor, n] of [[bondi, 1.08, 4], [newcastle, 0.93, 3]] as const) {
    for (const p of t.products.slice(10, 10 + n)) {
      await prisma.storeProduct.update({ where: { storeId_productId: { storeId, productId: p.id } }, data: { retailPrice: Math.round((p.retail * factor) / 10) * 10 - 1 } });
    }
  }

  // Newcastle's store agent is offline: a fresh retail publication stays queued for it.
  await prisma.store.update({ where: { id: newcastle }, data: { online: false, lastSeenAt: new Date(Date.now() - 3 * 3_600_000) } });
  const sanitiser = t.products.find((p) => p.name.startsWith('Hand Sanitiser'))!;
  const masks = t.products.find((p) => p.name.startsWith('Surgical Face Masks'))!;
  await createPublication(prisma, {
    tenantId: t.tenantId, kind: 'RETAIL_PRICE', title: 'Retail price update — infection control range', payload: { allStores: true, changes: [{ productId: sanitiser.id, retailPrice: 749 }, { productId: masks.id, retailPrice: 1099 }] },
    storeIds: allStores, createdById: pricingUser,
  });
  await runSync({ tenantId: t.tenantId, force: true });

  // A supplier price file validated and waiting for approval.
  const supplier = await prisma.supplier.findFirstOrThrow({ where: { tenantId: t.tenantId, name: 'Southern Cross Medical Supply' } });
  const sample = t.products.slice(0, 12);
  const rows = [
    ...sample.slice(0, 9).map((p, i) => ({ rowNo: i + 2, barcode: p.barcode, supplierCode: '', description: p.name, cost: ((p.cost * 1.04) / 100).toFixed(2), retail: (p.retail / 100).toFixed(2) })),
    { rowNo: 11, barcode: sample[9]!.barcode, supplierCode: '', description: sample[9]!.name, cost: ((sample[9]!.cost * 1.35) / 100).toFixed(2), retail: ((sample[9]!.retail * 1.2) / 100).toFixed(2) },
    { rowNo: 12, barcode: sample[10]!.barcode, supplierCode: '', description: sample[10]!.name, cost: ((sample[10]!.cost * 0.7) / 100).toFixed(2), retail: (sample[10]!.retail / 100).toFixed(2) },
    { rowNo: 13, barcode: '9399999999994', supplierCode: 'SC-NEW-01', description: 'New line — Magnesium 400 mg 60', cost: '11.20', retail: '22.99' },
    { rowNo: 14, barcode: '9399999999987', supplierCode: 'SC-NEW-02', description: 'New line — Zinc + C lozenges 30', cost: '5.10', retail: '10.99' },
    { rowNo: 15, barcode: sample[11]!.barcode, supplierCode: '', description: sample[11]!.name, cost: 'N/A', retail: '9.99' },
  ];
  const catalogue = await prisma.product.findMany({ where: { tenantId: t.tenantId } });
  const validated = validatePriceRows(rows, catalogue.map((p) => ({ id: p.id, barcode: p.barcode, cost: p.costPrice, retail: p.retailPrice })));
  const summary = validated.reduce<Record<string, number>>((a, r) => ({ ...a, [r.issue]: (a[r.issue] ?? 0) + 1 }), {});
  await prisma.priceFile.create({
    data: { tenantId: t.tenantId, supplierId: supplier.id, fileName: 'SCMS_price_update_2026-09.csv', uploadedById: pricingUser, summary: JSON.stringify(summary), createdAt: daysAgo(0, 8), lines: { create: validated.map((r) => ({ ...r, accepted: r.issue === 'OK' })) } },
  });

  await prisma.reportSchedule.create({ data: { tenantId: t.tenantId, template: 'sales-performance', cadence: 'WEEKLY', recipients: 'owner@harbourside.demo,finance@harbourside.demo', filters: '{}', nextRunAt: new Date(Date.now() + 3 * DAY), createdById: t.ownerId } });
}

/** Days 31–120: synthetic history scaled from each store's recent actuals, for longer trends. */
async function seedOlderMetrics(tenantId: string) {
  const recent = await prisma.storeDailyMetric.findMany({ where: { tenantId } });
  const byStore = new Map<string, typeof recent>();
  for (const m of recent) byStore.set(m.storeId, [...(byStore.get(m.storeId) ?? []), m]);
  const rows: object[] = [];
  for (const [storeId, ms] of byStore) {
    const avg = (k: 'retailSales' | 'retailCost' | 'transactions' | 'scripts' | 'pbsScripts' | 'scriptRevenue' | 'stockValue' | 'promoSales') => ms.reduce((s, m) => s + m[k], 0) / ms.length;
    const cats: Record<string, number> = {};
    for (const m of ms) for (const [k, v] of Object.entries(JSON.parse(m.categorySales) as Record<string, number>)) cats[k] = (cats[k] ?? 0) + v / ms.length;
    for (let d = 31; d <= 120; d++) {
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date(Date.now() - d * DAY));
      // Gentle growth trend: older days are a little lower, plus weekly seasonality and noise.
      const growth = 1 - d * 0.0012;
      const dow = new Date(Date.now() - d * DAY).getDay();
      const season = dow === 0 ? 0.7 : dow === 6 ? 0.9 : 1;
      const f = growth * season * (0.9 + R.next() * 0.2);
      rows.push({
        tenantId, storeId, date, retailSales: Math.round(avg('retailSales') * f), retailCost: Math.round(avg('retailCost') * f), transactions: Math.round(avg('transactions') * f),
        scripts: Math.round(avg('scripts') * f), pbsScripts: Math.round(avg('pbsScripts') * f), scriptRevenue: Math.round(avg('scriptRevenue') * f), stockValue: Math.round(avg('stockValue') * (0.95 + R.next() * 0.1)),
        stockouts: R.int(0, 4), promoSales: 0, categorySales: JSON.stringify(Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, Math.round(v * f)]))),
      });
    }
  }
  await createMany('historical metric rows', rows, (b) => prisma.storeDailyMetric.createMany({ data: b as never }));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
