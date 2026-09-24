import { CONCESSION_TYPES, safetyNetThreshold, type ConcessionType } from '@segue/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, audit } from '../../../core/audit';
import { requirePermission, tenantOf } from '../../../core/auth';
import { json, prisma, tx } from '../../../core/db';
import { notFound, parse } from '../../../core/errors';
import { currentMedications } from '../shared/dispense.service';
import { hydrateTokens, pickChanged } from '../shared/dispense.shared';

const allergy = z.object({ substance: z.string().min(1), reaction: z.string().optional().nullable(), severity: z.string().optional().nullable() });

// NB: no .default() in the base shape — zod's .partial() would re-apply defaults on PATCH
// and silently wipe fields such as allergies.
const patientFields = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dob: z.coerce.date(),
  gender: z.string().optional().nullable(),
  medicareNo: z.string().regex(/^\d{10,11}$/, 'Medicare number must be 10–11 digits').optional().nullable().or(z.literal('')),
  concessionType: z.enum(CONCESSION_TYPES),
  concessionNo: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.email().optional().nullable().or(z.literal('')),
  address: z.string().optional().nullable(),
  allergies: z.array(allergy),
  alerts: z.array(z.string()),
  notes: z.string().optional().nullable(),
});

const patientBody = patientFields.extend({
  concessionType: z.enum(CONCESSION_TYPES).default('GENERAL'),
  allergies: z.array(allergy).default([]),
  alerts: z.array(z.string()).default([]),
});

const patientPatch = patientFields.partial();

export async function patientsRoutes(app: FastifyInstance) {
  app.get('/patients', { preHandler: requirePermission('dispense.patients.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const { q } = parse(z.object({ q: z.string().optional() }), req.query);
    const term = q?.trim();
    const parts = term?.split(/[\s,]+/).filter(Boolean) ?? [];
    return prisma.patient.findMany({
      where: {
        tenantId,
        ...(parts.length
          ? { AND: parts.map((p) => ({ OR: [{ firstName: { contains: p } }, { lastName: { contains: p } }, { medicareNo: { contains: p } }, { phone: { contains: p } }] })) }
          : {}),
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 30,
    });
  });

  app.post('/patients', { preHandler: requirePermission('dispense.patients.write') }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(patientBody, req.body);
    return tx(async (db) => {
      const patient = await db.patient.create({
        data: { ...body, tenantId, medicareNo: body.medicareNo || null, email: body.email || null, allergies: json.stringify(body.allergies), alerts: json.stringify(body.alerts) },
      });
      await audit(db, actorFrom(req), { module: 'DISPENSE', action: 'patient.create', entityType: 'Patient', entityId: patient.id, summary: `Created patient ${patient.firstName} ${patient.lastName}` });
      return patient;
    });
  });

  app.get<{ Params: { id: string } }>('/patients/:id', { preHandler: requirePermission('dispense.patients.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const patient = await prisma.patient.findFirst({ where: { id: req.params.id, tenantId }, include: { customer: true } });
    if (!patient) throw notFound('Patient');
    const [history, meds] = await Promise.all([
      prisma.prescription.findMany({
        where: { patientId: patient.id },
        include: { drug: true, prescriber: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      currentMedications(prisma, patient.id),
    ]);
    const threshold = safetyNetThreshold(patient.concessionType as ConcessionType);
    return { ...patient, history, currentMedications: meds, safetyNet: { total: patient.safetyNetTotal, threshold, reached: patient.safetyNetTotal >= threshold } };
  });

  app.patch<{ Params: { id: string } }>('/patients/:id', { preHandler: requirePermission('dispense.patients.write') }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(patientPatch, req.body);
    const existing = await prisma.patient.findFirst({ where: { id: req.params.id, tenantId } });
    if (!existing) throw notFound('Patient');
    return tx(async (db) => {
      const patient = await db.patient.update({
        where: { id: existing.id },
        data: {
          ...body,
          medicareNo: body.medicareNo === undefined ? undefined : body.medicareNo || null,
          email: body.email === undefined ? undefined : body.email || null,
          allergies: body.allergies ? json.stringify(body.allergies) : undefined,
          alerts: body.alerts ? json.stringify(body.alerts) : undefined,
        },
      });
      await audit(db, actorFrom(req), {
        module: 'DISPENSE', action: 'patient.update', entityType: 'Patient', entityId: patient.id,
        summary: `Updated patient ${patient.firstName} ${patient.lastName}`,
        before: pickChanged(existing, body), after: pickChanged(patient, body),
      });
      return patient;
    });
  });

  /** Active Script List: unclaimed electronic tokens held for this patient. */
  app.get<{ Params: { id: string } }>('/patients/:id/asl', { preHandler: requirePermission('dispense.scripts.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const tokens = await prisma.erxToken.findMany({ where: { tenantId, patientId: req.params.id, claimed: false }, orderBy: { prescribedDate: 'desc' } });
    return hydrateTokens(tokens);
  });
}
