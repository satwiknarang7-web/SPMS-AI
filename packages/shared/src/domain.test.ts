import { describe, expect, it } from 'vitest';
import {
  applyPromotion,
  bestPromotion,
  calculatePbsCharge,
  cardSurcharge,
  cartTotals,
  checkMargin,
  effectivePermissions,
  expectedCash,
  licensedModules,
  parsePriceCsv,
  PBS_CONFIG,
  priceScript,
  privateScriptPrice,
  rankCandidates,
  resolveDispenseRule,
  resolveSetting,
  runSafetyChecks,
  settleTenders,
  validateDispenseRule,
  validatePriceRows,
  type DispensePricingRule,
} from './index';

describe('module licensing', () => {
  const now = new Date('2026-09-23T00:00:00Z');
  it('grants only active or trial, unexpired subscriptions', () => {
    const subs = [
      { module: 'DISPENSE', status: 'ACTIVE', expiresAt: null },
      { module: 'POS', status: 'TRIAL', expiresAt: '2026-12-31T00:00:00Z' },
      { module: 'OFFICE', status: 'ACTIVE', expiresAt: '2026-01-01T00:00:00Z' },
      { module: 'HQ', status: 'SUSPENDED', expiresAt: null },
    ];
    expect(licensedModules(subs, now)).toEqual(['DISPENSE', 'POS']);
  });

  it('strips permissions for modules the tenant has not licensed', () => {
    const perms = effectivePermissions(['STORE_MANAGER'], ['POS']);
    expect(perms).toContain('pos.refund');
    expect(perms).toContain('platform.users.manage');
    expect(perms.some((p) => p.startsWith('office.'))).toBe(false);
    expect(perms.some((p) => p.startsWith('hq.'))).toBe(false);
  });

  it('keeps clinical permissions away from retail roles', () => {
    const perms = effectivePermissions(['PHARMACY_ASSISTANT'], ['DISPENSE', 'POS', 'OFFICE', 'HQ']);
    expect(perms.some((p) => p.startsWith('dispense.'))).toBe(false);
  });
});

describe('PBS patient charges', () => {
  it('charges the general co-payment when the PBS price exceeds it', () => {
    const c = calculatePbsCharge({ scriptType: 'PBS', concession: 'GENERAL', dpmq: 6000, safetyNetReached: false });
    expect(c.patientCharge).toBe(PBS_CONFIG.generalCopay);
    expect(c.governmentContribution).toBe(6000 - PBS_CONFIG.generalCopay);
  });

  it('charges the full price for under co-payment items', () => {
    const c = calculatePbsCharge({ scriptType: 'PBS', concession: 'GENERAL', dpmq: 1500, safetyNetReached: false });
    expect(c.patientCharge).toBe(1500);
    expect(c.governmentContribution).toBe(0);
    expect(c.underCopayment).toBe(true);
  });

  it('applies concessional and safety net rules', () => {
    expect(calculatePbsCharge({ scriptType: 'PBS', concession: 'CONCESSION', dpmq: 6000, safetyNetReached: false }).patientCharge).toBe(770);
    expect(calculatePbsCharge({ scriptType: 'PBS', concession: 'CONCESSION', dpmq: 6000, safetyNetReached: true }).patientCharge).toBe(0);
    expect(calculatePbsCharge({ scriptType: 'PBS', concession: 'GENERAL', dpmq: 6000, safetyNetReached: true }).patientCharge).toBe(770);
    expect(calculatePbsCharge({ scriptType: 'RPBS', concession: 'GENERAL', dpmq: 6000, safetyNetReached: false }).patientCharge).toBe(770);
  });

  it('adds brand premium outside the safety net and caps discounts at $1', () => {
    const c = calculatePbsCharge({ scriptType: 'PBS', concession: 'GENERAL', dpmq: 6000, safetyNetReached: false, brandPremium: 350, copayDiscount: 500 });
    expect(c.patientCharge).toBe(PBS_CONFIG.generalCopay - 100 + 350);
    expect(c.safetyNetContribution).toBe(PBS_CONFIG.generalCopay - 100);
  });
});

describe('dispense pricing rules', () => {
  const groups = [
    { id: 'metro', priority: 10, createdAt: '2026-01-01' },
    { id: 'banner', priority: 1, createdAt: '2026-02-01' },
  ];
  const rule = (over: Partial<DispensePricingRule>): DispensePricingRule => ({
    id: 'r', groupId: 'metro', condition: 'PRIVATE', drugClass: null, markupPct: 30, dispensingFee: 850, copayDiscount: 0, minMarginPct: 20, ...over,
  });

  it('resolves group precedence deterministically (lowest priority number wins)', () => {
    const picked = resolveSetting([{ groupId: 'metro', v: 1 }, { groupId: 'banner', v: 2 }], groups);
    expect(picked?.v).toBe(2);
  });

  it('breaks priority ties by creation date', () => {
    const tied = [
      { id: 'b', priority: 5, createdAt: '2026-03-01' },
      { id: 'a', priority: 5, createdAt: '2026-01-01' },
    ];
    expect(resolveSetting([{ groupId: 'b' }, { groupId: 'a' }], tied)?.groupId).toBe('a');
  });

  it('prefers drug-class specific rules over generic ones', () => {
    const rules = [rule({ id: 'generic', groupId: 'banner' }), rule({ id: 'statins', groupId: 'metro', drugClass: 'Statin' })];
    expect(resolveDispenseRule(rules, groups, 'PRIVATE', 'Statin')?.id).toBe('statins');
    expect(resolveDispenseRule(rules, groups, 'PRIVATE', 'Antibiotic')?.id).toBe('generic');
  });

  it('prices private scripts with markup, fee and margin floor', () => {
    expect(privateScriptPrice(1000, { markupPct: 30, dispensingFee: 850, minMarginPct: 20 })).toBe(2150);
    // Tiny markup is lifted to the 50% margin floor: 1000 / 0.5 = 2000
    expect(privateScriptPrice(1000, { markupPct: 0, dispensingFee: 0, minMarginPct: 50 })).toBe(2000);
  });

  it('prices by packs for private scripts', () => {
    const p = priceScript({ scriptType: 'PRIVATE', concession: 'GENERAL', safetyNetReached: false, quantity: 60, packSize: 30, costPerPack: 1000, dpmq: null, brandPremium: 0 });
    expect(p.patientPrice).toBe(privateScriptPrice(2000));
  });

  it('rejects rules that would breach PBS maximum patient charges', () => {
    const v = validateDispenseRule({ condition: 'PBS', drugClass: null, markupPct: 10, dispensingFee: 0, copayDiscount: 150, minMarginPct: 0 });
    expect(v.map((x) => x.field)).toEqual(expect.arrayContaining(['copayDiscount', 'markupPct']));
    expect(validateDispenseRule({ condition: 'PBS', drugClass: null, markupPct: 0, dispensingFee: 0, copayDiscount: 100, minMarginPct: 0 })).toEqual([]);
  });
});

describe('clinical safety checks', () => {
  const drug = { name: 'Amoxicillin 500mg', ingredient: 'amoxicillin', drugClass: 'Penicillin', schedule: 'S4' };

  it('flags class allergies as HIGH', () => {
    const alerts = runSafetyChecks({ drug, allergies: [{ substance: 'Penicillin', reaction: 'Rash' }], currentMedications: [], interactions: [] });
    expect(alerts[0]).toMatchObject({ type: 'ALLERGY', severity: 'HIGH' });
  });

  it('detects interactions and duplicate therapy against current medications', () => {
    const alerts = runSafetyChecks({
      drug: { name: 'Aspirin 100mg', ingredient: 'aspirin', drugClass: 'Antiplatelet', schedule: 'S2' },
      allergies: [],
      currentMedications: [
        { name: 'Warfarin 5mg', ingredient: 'warfarin', drugClass: 'Anticoagulant', lastDispensedAt: new Date() },
        { name: 'Cartia 100mg', ingredient: 'aspirin', drugClass: 'Antiplatelet', lastDispensedAt: new Date() },
      ],
      interactions: [{ ingredientA: 'warfarin', ingredientB: 'aspirin', severity: 'HIGH', description: 'Increased bleeding risk.' }],
    });
    expect(alerts.map((a) => a.type)).toEqual(['INTERACTION', 'DUPLICATE_THERAPY']);
  });

  it('checks items on the same intake against each other', () => {
    const alerts = runSafetyChecks({
      drug: { name: 'Tramal 50mg', ingredient: 'tramadol', drugClass: 'Opioid', schedule: 'S4' },
      allergies: [],
      currentMedications: [],
      concurrentMedications: [
        { name: 'Zoloft 50mg', ingredient: 'sertraline', drugClass: 'SSRI' },
        { name: 'Tramedo 50mg', ingredient: 'tramadol', drugClass: 'Opioid' },
      ],
      interactions: [{ ingredientA: 'sertraline', ingredientB: 'tramadol', severity: 'HIGH', description: 'Serotonin syndrome risk.' }],
    });
    expect(alerts.map((a) => [a.type, a.severity])).toEqual([['INTERACTION', 'HIGH'], ['DUPLICATE_THERAPY', 'MODERATE']]);
    expect(alerts[0]!.title).toBe('Interaction with Zoloft 50mg (on this intake)');
  });

  it('flags S8 drugs and early repeats', () => {
    const alerts = runSafetyChecks({
      drug: { name: 'Oxycodone 5mg', ingredient: 'oxycodone', drugClass: 'Opioid', schedule: 'S8' },
      allergies: [], currentMedications: [], interactions: [],
      previousSupplyAt: '2026-09-20', minRepeatIntervalDays: 20, now: new Date('2026-09-23'),
    });
    expect(alerts.map((a) => a.type).sort()).toEqual(['CONTROLLED_DRUG', 'REPEAT_INTERVAL']);
  });
});

describe('drug ranking', () => {
  const c = (id: string, cost: number, price: number, onHand: number, flag: 'PREFERRED' | 'RESTRICTED' | 'EXCLUDED' | null = null) => ({ id, name: id, cost, price, onHand, flag });

  it('puts in-stock preferred items first and removes excluded ones', () => {
    const ranked = rankCandidates([c('A', 500, 900, 10), c('B', 400, 900, 0), c('C', 600, 900, 5, 'PREFERRED'), c('D', 100, 900, 50, 'EXCLUDED')], 'LOWEST_COST');
    expect(ranked.map((r) => r.candidate.id)).toEqual(['C', 'A', 'B']);
  });

  it('orders by the configured basis', () => {
    const items = [c('A', 500, 900, 10), c('B', 300, 1000, 20)];
    expect(rankCandidates(items, 'HIGHEST_MARGIN')[0]!.candidate.id).toBe('B');
    expect(rankCandidates(items, 'STOCK_ON_HAND')[0]!.candidate.id).toBe('B');
  });
});

describe('POS checkout', () => {
  const lines = [
    { unitPrice: 1100, quantity: 2, discount: 200, gstFree: false, isPbs: false },
    { unitPrice: 2500, quantity: 1, discount: 0, gstFree: true, isPbs: true },
  ];

  it('totals carts with GST only on taxable lines', () => {
    const t = cartTotals(lines);
    expect(t).toMatchObject({ subtotal: 4700, discountTotal: 200, total: 4500, pbsTotal: 2500, nonPbsTotal: 2000 });
    expect(t.gst).toBe(Math.round(2000 / 11));
  });

  it('never surcharges the PBS portion of a card payment', () => {
    expect(cardSurcharge(4500, 2000, 1.5)).toBe(30);
    expect(cardSurcharge(2500, 0, 1.5)).toBe(0);
  });

  it('allows cash over-tender but not card over-tender', () => {
    expect(settleTenders(4500, [{ type: 'CASH', amount: 5000 }])).toMatchObject({ ok: true, change: 500 });
    expect(settleTenders(4500, [{ type: 'EFTPOS', amount: 2000 }, { type: 'CASH', amount: 2500 }]).ok).toBe(true);
    expect(settleTenders(4500, [{ type: 'EFTPOS', amount: 5000 }]).ok).toBe(false);
    expect(settleTenders(4500, [{ type: 'CASH', amount: 4000 }]).outstanding).toBe(500);
  });

  it('warns on low margin and blocks below cost', () => {
    expect(checkMargin(1000, 800, 25).level).toBe('LOW_MARGIN');
    expect(checkMargin(700, 800, 25).level).toBe('BELOW_COST');
    expect(checkMargin(1500, 800, 25).level).toBe('OK');
  });

  it('applies the best promotion', () => {
    expect(applyPromotion(1000, { id: '1', name: 'x', type: 'PERCENT_OFF', value: 25 })).toBe(750);
    const best = bestPromotion(1000, [
      { id: 'a', name: 'a', type: 'AMOUNT_OFF', value: 100 },
      { id: 'b', name: 'b', type: 'FIXED_PRICE', value: 799 },
    ]);
    expect(best?.promo.id).toBe('b');
  });

  it('computes expected drawer cash', () => {
    expect(expectedCash({ openingFloat: 20000, cashSales: 15000, cashRefunds: 1000, paidIn: 500, paidOut: 2500 })).toBe(32000);
  });
});

describe('supplier price files', () => {
  const csv = [
    'barcode,supplier_code,description,cost,retail',
    '9300001,S1,Panadol 20,4.10,7.99',
    '9300002,S2,"Nurofen, 24",9.00,12.99',
    '9399999,S9,Unknown,1.00,2.00',
    '9300003,S3,Bad,abc,2.00',
    '9300001,S1,Dup,4.10,7.99',
  ].join('\n');
  const catalogue = [
    { id: 'p1', barcode: '9300001', cost: 400, retail: 799 },
    { id: 'p2', barcode: '9300002', cost: 600, retail: 1199 },
    { id: 'p3', barcode: '9300003', cost: 100, retail: 200 },
  ];

  it('parses quoted CSV and classifies every row', () => {
    const { rows, headerError } = parsePriceCsv(csv);
    expect(headerError).toBeNull();
    expect(rows[1]!.description).toBe('Nurofen, 24');
    const v = validatePriceRows(rows, catalogue);
    expect(v.map((r) => r.issue)).toEqual(['OK', 'OUTLIER', 'UNMATCHED', 'ERROR', 'ERROR']);
  });

  it('reports missing columns', () => {
    expect(parsePriceCsv('barcode,cost\n1,2').headerError).toMatch(/supplier_code/);
  });
});
