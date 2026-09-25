import { SCRIPT_TYPES, requiresIntervention, type SafetyAlert } from '@segue/shared';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorFrom, audit } from '../../../core/audit';
import { requirePermission, storeOf, tenantOf } from '../../../core/auth';
import { json, prisma, tx, type Db } from '../../../core/db';
import { badRequest, conflict, notFound, parse, unprocessable } from '../../../core/errors';
import { moveStock } from '../../../core/inventory';
import { nextNumber } from '../../../core/store-config';
import { batchSiblings, othersOnIntake, priceFor, safetyFor } from '../shared/dispense.service';
import { pickChanged } from '../shared/dispense.shared';

const scriptFields = {
  prescriberId: z.string(),
  drugId: z.string(),
  productId: z.string().nullable(),
  scriptType: z.enum(SCRIPT_TYPES),
  directions: z.string().min(2, 'Directions are required'),
  quantity: z.number().int().positive(),
  repeatsTotal: z.number().int().min(0).max(11),
  brandSubstitution: z.boolean(),
};

const scriptPatch = z.object(scriptFields).partial();

const scriptBody = z.object({
  patientId: z.string(),
  prescriberId: z.string(),
  drugId: z.string(),
  productId: z.string().nullable(),
  scriptType: z.enum(SCRIPT_TYPES),
  source: z.enum(['PAPER', 'ERX_TOKEN', 'ASL']),
  erxToken: z.string().optional().nullable(),
  prescribedDate: z.coerce.date(),
  directions: z.string().min(2, 'Directions are required'),
  quantity: z.number().int().positive(),
  repeatsTotal: z.number().int().min(0).max(11),
  brandSubstitution: z.boolean().default(true),
});

const quoteBody = z.object({
  patientId: z.string(),
  drugId: z.string(),
  productId: z.string().nullable(),
  scriptType: z.enum(SCRIPT_TYPES),
  quantity: z.number().int().positive(),
});

const MAX_INTAKE_ITEMS = 12;

/** Several medicines received together for one patient; each still becomes its own script. */
const batchQuoteBody = z.object({
  patientId: z.string(),
  items: z.array(quoteBody.omit({ patientId: true })).min(1).max(MAX_INTAKE_ITEMS),
});

const batchBody = z.object({
  patientId: z.string(),
  items: z.array(scriptBody.omit({ patientId: true })).min(1, 'Add at least one medicine').max(MAX_INTAKE_ITEMS),
  /** Send every item straight to the pharmacist's check queue. */
  submit: z.boolean().default(false),
});

type ScriptInput = z.infer<typeof scriptBody>;

const checkBody = z.object({
  scannedBarcode: z.string().optional().nullable(),
  /** Manual verification when the pack cannot be scanned (damaged barcode, split pack). */
  manualVerificationReason: z.string().min(5).optional().nullable(),
  interventions: z
    .array(z.object({ alertType: z.string(), outcome: z.enum(['SUPPLIED_AFTER_REVIEW', 'PRESCRIBER_CONTACTED', 'NOT_SUPPLIED']), note: z.string().min(3) }))
    .default([]),
});

const ACTIVE_STATUSES = ['IN_PROGRESS', 'AWAITING_CHECK', 'DEFERRED'];

export async function scriptsRoutes(app: FastifyInstance) {
  app.get('/scripts', { preHandler: requirePermission('dispense.scripts.read') }, async (req) => {
    const storeId = storeOf(req);
    const q = parse(z.object({ status: z.string().optional(), q: z.string().optional(), take: z.coerce.number().int().max(200).default(60) }), req.query);
    const statuses = q.status?.split(',').filter(Boolean);
    return prisma.prescription.findMany({
      where: {
        storeId,
        status: statuses?.length ? { in: statuses } : undefined,
        ...(q.q
          ? { OR: [{ number: { contains: q.q } }, { patient: { lastName: { contains: q.q } } }, { patient: { firstName: { contains: q.q } } }, { drug: { brandName: { contains: q.q } } }] }
          : {}),
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, concessionType: true } },
        prescriber: { select: { name: true } },
        drug: { select: { brandName: true, genericName: true, strength: true, form: true, schedule: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: q.take,
    });
  });

  app.post('/scripts/quote', { preHandler: requirePermission('dispense.scripts.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const storeId = storeOf(req);
    const body = parse(quoteBody, req.body);
    const { patient, drug } = await loadPatientDrug(prisma, tenantId, body.patientId, body.drugId);
    const [price, alerts] = await Promise.all([
      priceFor(prisma, { tenantId, storeId, patient, drug, productId: body.productId, scriptType: body.scriptType, quantity: body.quantity }),
      safetyFor(prisma, patient, drug),
    ]);
    return { price, alerts, requiresIntervention: requiresIntervention(alerts) };
  });

  app.post('/scripts/quote-batch', { preHandler: requirePermission('dispense.scripts.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const storeId = storeOf(req);
    const body = parse(batchQuoteBody, req.body);
    const patient = await loadPatient(prisma, tenantId, body.patientId);
    const drugs = await loadDrugs(prisma, tenantId, body.items.map((i) => i.drugId));
    const items = await Promise.all(
      body.items.map(async (item, idx) => {
        const drug = drugs[idx]!;
        const [price, alerts] = await Promise.all([
          priceFor(prisma, { tenantId, storeId, patient, drug, productId: item.productId, scriptType: item.scriptType, quantity: item.quantity }),
          safetyFor(prisma, patient, drug, { concurrent: othersOnIntake(drugs, idx) }),
        ]);
        return { drugId: drug.id, price, alerts, requiresIntervention: requiresIntervention(alerts) };
      }),
    );
    return {
      items,
      totalPatientPrice: items.reduce((sum, i) => sum + i.price.patientPrice, 0),
      requiresIntervention: items.some((i) => i.requiresIntervention),
    };
  });

  app.post('/scripts', { preHandler: requirePermission('dispense.scripts.write') }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(scriptBody, req.body);
    const { patient, drug } = await loadPatientDrug(prisma, tenantId, body.patientId, body.drugId);
    await validateScript(tenantId, body, drug);
    return tx((db) => createScript(req, db, patient, drug, body, { batchId: null, concurrent: [] }));
  });

  /**
   * Multi-item intake: creates one script per medicine in a single transaction (all or
   * nothing), linked by a batch id and safety-checked against each other as well as the
   * patient's history.
   */
  app.post('/scripts/batch', { preHandler: requirePermission('dispense.scripts.write') }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(batchBody, req.body);
    const patient = await loadPatient(prisma, tenantId, body.patientId);
    const drugs = await loadDrugs(prisma, tenantId, body.items.map((i) => i.drugId));
    const tokens = body.items.map((i) => i.erxToken?.toUpperCase()).filter((t): t is string => !!t);
    if (new Set(tokens).size !== tokens.length) throw badRequest('The same eRx token appears more than once on this intake');
    for (const [idx, item] of body.items.entries()) {
      await validateScript(tenantId, { ...item, patientId: patient.id }, drugs[idx]!, `Item ${idx + 1}: `);
    }
    const batchId = body.items.length > 1 ? randomUUID() : null;
    const scripts = await tx(async (db) => {
      const created = [];
      for (const [idx, item] of body.items.entries()) {
        const script = await createScript(req, db, patient, drugs[idx]!, { ...item, patientId: patient.id }, { batchId, concurrent: othersOnIntake(drugs, idx) });
        if (body.submit) {
          if (!script.productId) throw unprocessable(`Item ${idx + 1}: select the pack to dispense before sending for check`);
          await db.prescription.update({ where: { id: script.id }, data: { status: 'AWAITING_CHECK' } });
          await audit(db, actorFrom(req), {
            module: 'DISPENSE', action: 'script.submit', entityType: 'Prescription', entityId: script.id,
            summary: `Script ${script.number} sent for pharmacist check`, before: { status: 'IN_PROGRESS' }, after: { status: 'AWAITING_CHECK' },
          });
        }
        created.push({ id: script.id, number: script.number, status: body.submit ? 'AWAITING_CHECK' : script.status });
      }
      return created;
    });
    return { batchId, scripts };
  });

  app.get<{ Params: { id: string } }>('/scripts/:id', { preHandler: requirePermission('dispense.scripts.read') }, async (req) => {
    const script = await loadScript(req, req.params.id);
    const [trail, supplies, users] = await Promise.all([
      prisma.auditEvent.findMany({ where: { entityType: 'Prescription', entityId: script.id }, orderBy: { createdAt: 'asc' } }),
      prisma.prescription.findMany({
        where: { OR: [{ id: script.originalId ?? script.id }, { originalId: script.originalId ?? script.id }] },
        select: { id: true, number: true, supplyNo: true, status: true, dispensedAt: true },
        orderBy: { supplyNo: 'asc' },
      }),
      prisma.user.findMany({ where: { id: { in: [script.preparedById, script.checkedById].filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
    ]);
    const [store, batch] = await Promise.all([
      prisma.store.findUnique({ where: { id: script.storeId } }),
      script.batchId
        ? prisma.prescription.findMany({
            where: { batchId: script.batchId },
            select: { id: true, number: true, status: true, drug: { select: { brandName: true, strength: true } } },
            orderBy: { number: 'asc' },
          })
        : [],
    ]);
    const name = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
    return {
      ...script,
      alerts: json.parse<SafetyAlert[]>(script.alerts, []),
      patient: { ...script.patient, allergies: json.parse(script.patient.allergies, []), alerts: json.parse(script.patient.alerts, []) },
      preparedBy: name(script.preparedById),
      checkedBy: name(script.checkedById),
      store,
      supplies,
      batch,
      auditTrail: trail,
    };
  });

  app.patch<{ Params: { id: string } }>('/scripts/:id', { preHandler: requirePermission('dispense.scripts.write') }, async (req) => {
    const tenantId = tenantOf(req);
    const storeId = storeOf(req);
    const existing = await loadScript(req, req.params.id);
    if (!ACTIVE_STATUSES.includes(existing.status)) throw conflict(`A ${existing.status.toLowerCase()} script cannot be edited`);
    const body = parse(scriptPatch, req.body);
    const drugId = body.drugId ?? existing.drugId;
    const { patient, drug } = await loadPatientDrug(prisma, tenantId, existing.patientId, drugId);
    const merged = { ...existing, ...body };
    validateAgainstDrug({ quantity: merged.quantity, repeatsTotal: merged.repeatsTotal }, drug);
    if (merged.productId) await assertProductForDrug(tenantId, merged.productId, drug.id, merged.brandSubstitution);
    if (body.prescriberId) await assertPrescriber(tenantId, body.prescriberId);

    return tx(async (db) => {
      const [price, alerts] = await Promise.all([
        priceFor(db, { tenantId, storeId, patient, drug, productId: merged.productId, scriptType: merged.scriptType as 'PBS', quantity: merged.quantity }),
        safetyFor(db, patient, drug, { excludeScriptId: existing.id, concurrent: await batchSiblings(db, existing.batchId, existing.id) }),
      ]);
      const script = await db.prescription.update({
        where: { id: existing.id },
        data: {
          ...body,
          status: 'IN_PROGRESS',
          scanVerified: false,
          patientPrice: price.patientPrice,
          governmentContribution: price.governmentContribution,
          safetyNetContribution: price.safetyNetContribution,
          pricingBasis: price.basis,
          alerts: json.stringify(alerts),
        },
      });
      await audit(db, actorFrom(req), {
        module: 'DISPENSE', action: 'script.update', entityType: 'Prescription', entityId: script.id, summary: `Script ${script.number} edited`,
        before: pickChanged(existing, body), after: pickChanged(script, body),
      });
      return script;
    });
  });

  /** Technician hands the prepared script to the pharmacist for final check. */
  app.post<{ Params: { id: string } }>('/scripts/:id/submit', { preHandler: requirePermission('dispense.scripts.write') }, async (req) => {
    const s = await loadScript(req, req.params.id);
    if (s.status !== 'IN_PROGRESS') throw conflict('Only in-progress scripts can be sent for checking');
    if (!s.productId) throw unprocessable('Select the pack to dispense before sending for check');
    return transition(req, s.id, 'AWAITING_CHECK', 'script.submit', `Script ${s.number} sent for pharmacist check`);
  });

  /**
   * Final check and dispense (pharmacist only). Re-runs safety checks, requires a scan match
   * (or a documented manual verification) and acknowledged interventions for HIGH alerts,
   * then writes the dispensing record, reduces stock and updates the safety net.
   */
  app.post<{ Params: { id: string } }>('/scripts/:id/check', { preHandler: requirePermission('dispense.scripts.check') }, async (req) => {
    const storeId = storeOf(req);
    const body = parse(checkBody, req.body);
    const s = await loadScript(req, req.params.id);
    if (!['IN_PROGRESS', 'AWAITING_CHECK'].includes(s.status)) throw conflict(`A ${s.status.toLowerCase()} script cannot be checked`);
    if (!s.product) throw unprocessable('Select the pack to dispense before the final check');

    const scanOk = !!body.scannedBarcode && body.scannedBarcode.trim() === s.product.barcode;
    if (body.scannedBarcode && !scanOk) {
      await tx((db) => audit(db, actorFrom(req), {
        module: 'DISPENSE', action: 'script.scan_mismatch', entityType: 'Prescription', entityId: s.id,
        summary: `Scan check mismatch on ${s.number}: scanned ${body.scannedBarcode}, expected ${s.product!.barcode}`,
      }));
      throw unprocessable('Scanned pack does not match the selected item', { expected: s.product.name, scanned: body.scannedBarcode });
    }
    if (!scanOk && !body.manualVerificationReason) throw unprocessable('Scan the pack, or record a manual verification reason');

    const previous = s.originalId
      ? await prisma.prescription.findFirst({ where: { OR: [{ id: s.originalId }, { originalId: s.originalId }], supplyNo: s.supplyNo - 1 }, select: { dispensedAt: true } })
      : null;
    const alerts = await safetyFor(prisma, s.patient, s.drug, { excludeScriptId: s.id, previousSupplyAt: previous?.dispensedAt, concurrent: await batchSiblings(prisma, s.batchId, s.id) });
    const highAlerts = alerts.filter((a) => a.severity === 'HIGH');
    const unaddressed = highAlerts.filter((a) => !body.interventions.some((i) => i.alertType === a.type));
    if (unaddressed.length) throw unprocessable('Record an intervention for each high-severity alert', { alerts: unaddressed });
    if (body.interventions.some((i) => i.outcome === 'NOT_SUPPLIED')) throw unprocessable('Intervention outcome is "not supplied" — cancel or defer the script instead');

    return tx(async (db) => {
      for (const i of body.interventions) {
        await db.clinicalIntervention.create({ data: { prescriptionId: s.id, alertType: i.alertType, outcome: i.outcome, note: i.note, userId: req.ctx.userId } });
      }
      const packs = Math.max(1, Math.ceil(s.quantity / Math.max(1, s.drug.packSize)));
      await moveStock(db, { storeId, productId: s.product!.id, quantity: -packs, reason: 'DISPENSE', refType: 'Prescription', refId: s.id, userId: req.ctx.userId });
      if (s.safetyNetContribution) {
        await db.patient.update({ where: { id: s.patientId }, data: { safetyNetTotal: { increment: s.safetyNetContribution } } });
      }
      const script = await db.prescription.update({
        where: { id: s.id },
        data: { status: 'READY', checkedById: req.ctx.userId, dispensedAt: new Date(), scanVerified: scanOk, alerts: json.stringify(alerts) },
      });
      await audit(db, actorFrom(req), {
        module: 'DISPENSE', action: 'script.dispense', entityType: 'Prescription', entityId: s.id,
        summary: `Script ${s.number} final-checked and dispensed (${scanOk ? 'scan verified' : `manual verification: ${body.manualVerificationReason}`}); ${packs} pack(s) deducted`,
        before: { status: s.status }, after: { status: 'READY', interventions: body.interventions.length, alerts: alerts.map((a) => `${a.severity}: ${a.title}`) },
      });
      return script;
    });
  });

  app.post<{ Params: { id: string } }>('/scripts/:id/defer', { preHandler: requirePermission('dispense.scripts.write') }, async (req) => {
    const { reason } = parse(z.object({ reason: z.string().min(3) }), req.body);
    const s = await loadScript(req, req.params.id);
    if (!['IN_PROGRESS', 'AWAITING_CHECK'].includes(s.status)) throw conflict('Only undispensed scripts can be deferred');
    return transition(req, s.id, 'DEFERRED', 'script.defer', `Script ${s.number} deferred: ${reason}`);
  });

  app.post<{ Params: { id: string } }>('/scripts/:id/resume', { preHandler: requirePermission('dispense.scripts.write') }, async (req) => {
    const s = await loadScript(req, req.params.id);
    if (s.status !== 'DEFERRED') throw conflict('Only deferred scripts can be resumed');
    return transition(req, s.id, 'IN_PROGRESS', 'script.resume', `Script ${s.number} resumed`);
  });

  app.post<{ Params: { id: string } }>('/scripts/:id/cancel', { preHandler: requirePermission('dispense.scripts.write') }, async (req) => {
    const { reason } = parse(z.object({ reason: z.string().min(3) }), req.body);
    const s = await loadScript(req, req.params.id);
    if (!ACTIVE_STATUSES.includes(s.status)) throw conflict('Dispensed scripts cannot be cancelled — process a return instead');
    return tx(async (db) => {
      // Release an electronic token back to the exchange so it can be dispensed elsewhere.
      if (s.erxToken) await db.erxToken.updateMany({ where: { token: s.erxToken }, data: { claimed: false } });
      const script = await db.prescription.update({ where: { id: s.id }, data: { status: 'CANCELLED' } });
      await audit(db, actorFrom(req), { module: 'DISPENSE', action: 'script.cancel', entityType: 'Prescription', entityId: s.id, summary: `Script ${s.number} cancelled: ${reason}`, before: { status: s.status }, after: { status: 'CANCELLED' } });
      return script;
    });
  });

  /** Hand-out without POS (e.g. a tenant that has not purchased the POS module). */
  app.post<{ Params: { id: string } }>('/scripts/:id/collect', { preHandler: requirePermission('dispense.scripts.write') }, async (req) => {
    const s = await loadScript(req, req.params.id);
    if (s.status !== 'READY') throw conflict('Only dispensed scripts awaiting collection can be handed out');
    return tx(async (db) => {
      const script = await db.prescription.update({ where: { id: s.id }, data: { status: 'COLLECTED', collectedAt: new Date() } });
      await audit(db, actorFrom(req), { module: 'DISPENSE', action: 'script.collect', entityType: 'Prescription', entityId: s.id, summary: `Script ${s.number} collected by patient`, before: { status: 'READY' }, after: { status: 'COLLECTED' } });
      return script;
    });
  });

  /** Dispense the next repeat: a new supply record linked to the original prescription. */
  app.post<{ Params: { id: string } }>('/scripts/:id/repeat', { preHandler: requirePermission('dispense.scripts.write') }, async (req) => {
    const storeId = storeOf(req);
    const s = await loadScript(req, req.params.id);
    const rootId = s.originalId ?? s.id;
    const chain = await prisma.prescription.findMany({ where: { OR: [{ id: rootId }, { originalId: rootId }], status: { not: 'CANCELLED' } }, orderBy: { supplyNo: 'desc' } });
    const latest = chain[0]!;
    if (!['READY', 'COLLECTED'].includes(latest.status)) throw conflict('The previous supply has not been dispensed yet');
    if (latest.supplyNo >= latest.repeatsTotal) throw conflict('No repeats remain on this prescription');
    return tx(async (db) => {
      const number = await nextNumber(() => db.prescription.count({ where: { storeId } }), 'RX', 7);
      const repeat = await db.prescription.create({
        data: {
          tenantId: latest.tenantId, storeId, number, patientId: latest.patientId, prescriberId: latest.prescriberId, drugId: latest.drugId, productId: latest.productId,
          scriptType: latest.scriptType, source: latest.source, erxToken: null, prescribedDate: latest.prescribedDate, directions: latest.directions,
          quantity: latest.quantity, repeatsTotal: latest.repeatsTotal, supplyNo: latest.supplyNo + 1, originalId: rootId, brandSubstitution: latest.brandSubstitution,
          status: 'IN_PROGRESS', patientPrice: latest.patientPrice, governmentContribution: latest.governmentContribution, safetyNetContribution: latest.safetyNetContribution,
          pricingBasis: latest.pricingBasis, preparedById: req.ctx.userId,
        },
      });
      await audit(db, actorFrom(req), {
        module: 'DISPENSE', action: 'script.repeat', entityType: 'Prescription', entityId: repeat.id,
        summary: `Repeat ${repeat.supplyNo} of ${repeat.repeatsTotal} started from ${latest.number}`,
      });
      return repeat;
    });
  });
}

async function loadScript(req: FastifyRequest, id: string) {
  const storeId = storeOf(req);
  const script = await prisma.prescription.findFirst({
    where: { id, storeId },
    include: { patient: true, prescriber: true, drug: true, product: true, interventions: true },
  });
  if (!script) throw notFound('Prescription');
  return script;
}

async function loadPatient(db: Db, tenantId: string, patientId: string) {
  const patient = await db.patient.findFirst({ where: { id: patientId, tenantId } });
  if (!patient) throw notFound('Patient');
  return patient;
}

/** Drugs in the same order as `ids` (ids may repeat). */
async function loadDrugs(db: Db, tenantId: string, ids: string[]) {
  const rows = await db.drug.findMany({ where: { id: { in: [...new Set(ids)] }, tenantId } });
  return ids.map((id) => {
    const drug = rows.find((d) => d.id === id);
    if (!drug) throw notFound('Medicine');
    return drug;
  });
}

type PatientRow = Awaited<ReturnType<typeof loadPatient>>;
type DrugRow = Awaited<ReturnType<typeof loadDrugs>>[number];

/** Checks that don't need the transaction: prescriber, quantities, pack/brand substitution. */
async function validateScript(tenantId: string, body: ScriptInput, drug: DrugRow, prefix = '') {
  try {
    await assertPrescriber(tenantId, body.prescriberId);
    validateAgainstDrug(body, drug);
    if (body.productId) await assertProductForDrug(tenantId, body.productId, drug.id, body.brandSubstitution);
  } catch (e) {
    if (prefix && e instanceof Error) e.message = `${prefix}${e.message}`;
    throw e;
  }
}

/** Claims the eRx token (if any), prices, safety-checks and records one script. Runs inside a transaction. */
async function createScript(req: FastifyRequest, db: Db, patient: PatientRow, drug: DrugRow, body: ScriptInput, opts: { batchId: string | null; concurrent: ReturnType<typeof othersOnIntake> }) {
  const tenantId = tenantOf(req);
  const storeId = storeOf(req);
  if (body.source !== 'PAPER') {
    if (!body.erxToken) throw badRequest('An eRx token is required for electronic prescriptions');
    const token = await db.erxToken.findFirst({ where: { tenantId, token: body.erxToken.toUpperCase() } });
    if (!token) throw notFound('Electronic prescription token');
    if (token.claimed) throw conflict(`Token ${token.token} has already been dispensed`);
    if (token.patientId !== patient.id) throw badRequest(`Token ${token.token} was issued for a different patient`);
    await db.erxToken.update({ where: { token: token.token }, data: { claimed: true } });
  }
  const [price, alerts] = await Promise.all([
    priceFor(db, { tenantId, storeId, patient, drug, productId: body.productId, scriptType: body.scriptType, quantity: body.quantity }),
    safetyFor(db, patient, drug, { concurrent: opts.concurrent }),
  ]);
  const number = await nextNumber(() => db.prescription.count({ where: { storeId } }), 'RX', 7);
  const script = await db.prescription.create({
    data: {
      ...body,
      erxToken: body.erxToken?.toUpperCase() ?? null,
      tenantId,
      storeId,
      number,
      batchId: opts.batchId,
      status: 'IN_PROGRESS',
      patientPrice: price.patientPrice,
      governmentContribution: price.governmentContribution,
      safetyNetContribution: price.safetyNetContribution,
      pricingBasis: price.basis,
      alerts: json.stringify(alerts),
      preparedById: req.ctx.userId,
    },
  });
  await audit(db, actorFrom(req), {
    module: 'DISPENSE', action: 'script.create', entityType: 'Prescription', entityId: script.id,
    summary: `Script ${number} created — ${drug.brandName} ${drug.strength} × ${body.quantity} (${body.source === 'PAPER' ? 'paper' : 'eRx'})${opts.batchId ? ' as part of a multi-item intake' : ''}`,
    after: { status: script.status, patientPrice: price.patientPrice, alerts: alerts.map((a) => a.title), batchId: opts.batchId },
  });
  return script;
}

async function loadPatientDrug(db: Db, tenantId: string, patientId: string, drugId: string) {
  const [patient, drug] = await Promise.all([db.patient.findFirst({ where: { id: patientId, tenantId } }), db.drug.findFirst({ where: { id: drugId, tenantId } })]);
  if (!patient) throw notFound('Patient');
  if (!drug) throw notFound('Medicine');
  return { patient, drug };
}

async function assertPrescriber(tenantId: string, id: string) {
  if (!(await prisma.prescriber.findFirst({ where: { id, tenantId } }))) throw notFound('Prescriber');
}

async function assertProductForDrug(tenantId: string, productId: string, drugId: string, brandSubstitution: boolean) {
  const product = await prisma.product.findFirst({ where: { id: productId, tenantId }, include: { drug: true } });
  if (!product?.drug) throw badRequest('Selected pack is not a dispensable medicine');
  if (product.drugId === drugId) return;
  const target = await prisma.drug.findUnique({ where: { id: drugId } });
  const substitutable = target && product.drug.genericName === target.genericName && product.drug.strength === target.strength && product.drug.form === target.form;
  if (!substitutable) throw badRequest('Selected pack is not a substitutable brand of the prescribed medicine');
  if (!brandSubstitution) throw badRequest('Brand substitution is not permitted on this prescription');
}

function validateAgainstDrug(body: { quantity: number; repeatsTotal: number }, drug: { maxQuantity: number | null; maxRepeats: number | null }) {
  // PBS maxima are advisory for private scripts but reported so the pharmacist sees them.
  if (drug.maxQuantity && body.quantity > drug.maxQuantity * 4) throw badRequest(`Quantity ${body.quantity} is implausible for this item (PBS max ${drug.maxQuantity})`);
  if (body.repeatsTotal > 11) throw badRequest('Too many repeats');
}

async function transition(req: FastifyRequest, id: string, status: string, action: string, summary: string) {
  return tx(async (db) => {
    const before = await db.prescription.findUniqueOrThrow({ where: { id } });
    const script = await db.prescription.update({ where: { id }, data: { status } });
    await audit(db, actorFrom(req), { module: 'DISPENSE', action, entityType: 'Prescription', entityId: id, summary, before: { status: before.status }, after: { status } });
    return script;
  });
}
