import { PRICING_CONDITIONS, conditionFor, marginPct, priceScript, validateDispenseRule, type ConcessionType, type DispensePricingRule, type ScriptType } from '@segue/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, audit } from '../../../core/audit';
import { requirePermission, tenantOf } from '../../../core/auth';
import { prisma, tx } from '../../../core/db';
import { conflict, notFound, parse, unprocessable } from '../../../core/errors';
import { futureDate } from '../shared/hq.shared';
import { createPublication } from '../sync/publication.service';

const ruleBody = z.object({
  name: z.string().min(2),
  groupId: z.string(),
  condition: z.enum(PRICING_CONDITIONS),
  drugClass: z.string().optional().nullable().transform((v) => v || null),
  markupPct: z.number().min(0).max(500).default(0),
  dispensingFee: z.number().int().min(0).default(0),
  copayDiscount: z.number().int().min(0).default(0),
  minMarginPct: z.number().min(0).max(90).default(0),
});

export async function dispensePricingRoutes(app: FastifyInstance) {
  app.get('/pricing/rules', { preHandler: requirePermission('hq.config.read') }, async (req) => {
    const tenantId = tenantOf(req);
    const [rules, groups] = await Promise.all([
      prisma.dispensePricingRule.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } }),
      prisma.storeGroup.findMany({ where: { tenantId } }),
    ]);
    const pubs = await prisma.publication.findMany({ where: { id: { in: rules.map((r) => r.publicationId).filter((x): x is string => !!x) } }, include: { targets: { select: { status: true } } } });
    return rules.map((r) => {
      const pub = pubs.find((p) => p.id === r.publicationId);
      return {
        ...r,
        groupName: groups.find((g) => g.id === r.groupId)?.name ?? 'Deleted group',
        delivery: pub ? { effectiveAt: pub.effectiveAt, applied: pub.targets.filter((t) => t.status === 'APPLIED').length, total: pub.targets.length } : null,
      };
    });
  });

  app.post('/pricing/rules', { preHandler: requirePermission('hq.pricing.write') }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(ruleBody, req.body);
    const violations = validateDispenseRule(body);
    if (violations.length) throw unprocessable('This rule would breach PBS pricing limits', { violations });
    if (!(await prisma.storeGroup.findFirst({ where: { id: body.groupId, tenantId } }))) throw notFound('Store group');
    return tx(async (db) => {
      const rule = await db.dispensePricingRule.create({ data: { ...body, tenantId, status: 'DRAFT' } });
      await audit(db, actorFrom(req), { module: 'HQ', action: 'pricing.rule.create', entityType: 'DispensePricingRule', entityId: rule.id, storeId: null, summary: `Dispense pricing rule "${rule.name}" drafted`, after: body });
      return rule;
    });
  });

  app.delete<{ Params: { id: string } }>('/pricing/rules/:id', { preHandler: requirePermission('hq.pricing.write') }, async (req) => {
    const tenantId = tenantOf(req);
    const rule = await prisma.dispensePricingRule.findFirst({ where: { id: req.params.id, tenantId } });
    if (!rule) throw notFound('Rule');
    if (rule.status !== 'DRAFT') throw conflict('Only draft rules can be deleted — roll back published rules instead');
    return tx(async (db) => {
      await db.dispensePricingRule.delete({ where: { id: rule.id } });
      await audit(db, actorFrom(req), { module: 'HQ', action: 'pricing.rule.delete', entityType: 'DispensePricingRule', entityId: rule.id, storeId: null, summary: `Draft rule "${rule.name}" deleted`, before: rule });
      return { deleted: true };
    });
  });

  /** HQ-DP-05: what would this rule have done to the last 30 days of dispensing? */
  app.post('/pricing/simulate', { preHandler: requirePermission('hq.pricing.write') }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(ruleBody, req.body);
    const violations = validateDispenseRule(body);
    const group = await prisma.storeGroup.findFirst({ where: { id: body.groupId, tenantId }, include: { members: true } });
    if (!group) throw notFound('Store group');
    const storeIds = group.members.map((m) => m.storeId);
    const since = new Date(Date.now() - 30 * 86_400_000);
    // De-identified: only script economics and the concession category are read.
    const scripts = await prisma.prescription.findMany({
      where: { storeId: { in: storeIds }, dispensedAt: { gte: since }, drug: body.drugClass ? { drugClass: body.drugClass } : undefined },
      select: { storeId: true, scriptType: true, quantity: true, patientPrice: true, governmentContribution: true, patient: { select: { concessionType: true } }, drug: { select: { packSize: true, dpmq: true, brandPremium: true, drugClass: true } }, product: { select: { costPrice: true } } },
    });
    const matching = scripts.filter((s) => conditionFor(s.scriptType as ScriptType, s.patient.concessionType as ConcessionType) === body.condition);
    const rule: DispensePricingRule = { id: 'simulation', ...body };
    let current = 0;
    let simulated = 0;
    let cost = 0;
    const byClass = new Map<string, { scripts: number; current: number; simulated: number }>();
    for (const s of matching) {
      const packs = Math.max(1, Math.ceil(s.quantity / Math.max(1, s.drug.packSize)));
      const packCost = (s.product?.costPrice ?? 0) * packs;
      const sim = priceScript({
        scriptType: s.scriptType as ScriptType, concession: s.patient.concessionType as ConcessionType, safetyNetReached: false, quantity: s.quantity,
        packSize: s.drug.packSize, costPerPack: s.product?.costPrice ?? 0, dpmq: s.scriptType === 'PRIVATE' ? null : s.drug.dpmq, brandPremium: s.drug.brandPremium, rule,
      });
      const cur = (s.patientPrice ?? 0) + (s.governmentContribution ?? 0);
      const next = sim.patientPrice + sim.governmentContribution;
      current += cur;
      simulated += next;
      cost += packCost;
      const cls = s.drug.drugClass ?? 'Unclassified';
      const e = byClass.get(cls) ?? { scripts: 0, current: 0, simulated: 0 };
      e.scripts++;
      e.current += cur;
      e.simulated += next;
      byClass.set(cls, e);
    }
    return {
      violations,
      stores: storeIds.length,
      scripts: matching.length,
      currentRevenue: current,
      simulatedRevenue: simulated,
      delta: simulated - current,
      currentMarginPct: marginPct(current, cost),
      simulatedMarginPct: marginPct(simulated, cost),
      byClass: [...byClass.entries()].map(([drugClass, v]) => ({ drugClass, ...v, delta: v.simulated - v.current })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 10),
    };
  });

  app.post<{ Params: { id: string } }>('/pricing/rules/:id/publish', { preHandler: requirePermission('hq.publish') }, async (req) => {
    const tenantId = tenantOf(req);
    const { effectiveAt } = parse(z.object({ effectiveAt: futureDate }), req.body ?? {});
    const rule = await prisma.dispensePricingRule.findFirst({ where: { id: req.params.id, tenantId } });
    if (!rule) throw notFound('Rule');
    if (rule.status !== 'DRAFT') throw conflict('Only draft rules can be published');
    const violations = validateDispenseRule(rule as unknown as DispensePricingRule);
    if (violations.length) throw unprocessable('This rule would breach PBS pricing limits', { violations });
    const members = await prisma.storeGroupMember.findMany({ where: { groupId: rule.groupId, store: { status: 'ACTIVE' } } });
    return tx(async (db) => {
      const pub = await createPublication(db, { tenantId, kind: 'DISPENSE_PRICING', title: `Dispense pricing: ${rule.name}`, payload: { ruleId: rule.id }, storeIds: members.map((m) => m.storeId), effectiveAt, createdById: req.ctx.userId });
      await db.dispensePricingRule.update({ where: { id: rule.id }, data: { status: 'SCHEDULED', publicationId: pub.id, effectiveAt: pub.effectiveAt } });
      await audit(db, actorFrom(req), {
        module: 'HQ', action: 'pricing.rule.publish', entityType: 'DispensePricingRule', entityId: rule.id, storeId: null,
        summary: `Rule "${rule.name}" published to ${members.length} store(s), effective ${pub.effectiveAt.toISOString()}`, before: { status: 'DRAFT' }, after: { status: 'SCHEDULED', publicationId: pub.id },
      });
      return pub;
    });
  });
}
