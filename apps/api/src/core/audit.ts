import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { prisma, type Db } from './db';

export type AuditModule = 'DISPENSE' | 'POS' | 'OFFICE' | 'HQ' | 'PLATFORM';

export interface AuditInput {
  module: AuditModule;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
  storeId?: string | null;
}

export interface AuditActor {
  tenantId: string | null;
  storeId: string | null;
  userId: string | null;
  userName: string | null;
  role: string | null;
}

export const actorFrom = (req: FastifyRequest): AuditActor => ({
  tenantId: req.ctx.tenantId,
  storeId: req.ctx.storeId,
  userId: req.ctx.userId,
  userName: req.ctx.userName,
  role: req.ctx.roles.join(',') || (req.ctx.isPlatformAdmin ? 'PLATFORM_ADMIN' : null),
});

export const systemActor = (tenantId: string | null, storeId: string | null = null): AuditActor => ({
  tenantId,
  storeId,
  userId: null,
  userName: 'Segue sync service',
  role: 'SYSTEM',
});

const toJson = (v: unknown) => (v === undefined ? null : JSON.stringify(v));

function computeHash(prevHash: string | null, e: Record<string, unknown>): string {
  return createHash('sha256')
    .update(prevHash ?? 'GENESIS')
    .update(JSON.stringify(e))
    .digest('hex');
}

/**
 * Append a tamper-evident audit event. Call inside the same transaction as the change
 * it records so the audit trail can never disagree with the data.
 */
export async function audit(db: Db, actor: AuditActor, input: AuditInput) {
  const last = await db.auditEvent.findFirst({
    where: { tenantId: actor.tenantId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { hash: true, createdAt: true },
  });
  // Strictly increasing timestamps keep the chain order unambiguous.
  const now = Date.now();
  const createdAt = new Date(last && last.createdAt.getTime() >= now ? last.createdAt.getTime() + 1 : now);
  const record = {
    tenantId: actor.tenantId,
    storeId: input.storeId !== undefined ? input.storeId : actor.storeId,
    userId: actor.userId,
    userName: actor.userName,
    role: actor.role,
    module: input.module,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    summary: input.summary,
    before: toJson(input.before),
    after: toJson(input.after),
    context: 'ONLINE',
    createdAt: createdAt.toISOString(),
  };
  const prevHash = last?.hash ?? null;
  const hash = computeHash(prevHash, record);
  return db.auditEvent.create({ data: { ...record, createdAt, prevHash, hash } });
}

/** Re-computes the hash chain for a tenant and reports the first broken link, if any. */
export async function verifyAuditChain(tenantId: string | null) {
  const events = await prisma.auditEvent.findMany({ where: { tenantId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  let prev: string | null = null;
  for (const e of events) {
    const record = {
      tenantId: e.tenantId,
      storeId: e.storeId,
      userId: e.userId,
      userName: e.userName,
      role: e.role,
      module: e.module,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      summary: e.summary,
      before: e.before,
      after: e.after,
      context: e.context,
      createdAt: e.createdAt.toISOString(),
    };
    if (e.prevHash !== prev || computeHash(prev, record) !== e.hash) {
      return { valid: false, checked: events.length, brokenAt: e.id, brokenAtTime: e.createdAt };
    }
    prev = e.hash;
  }
  return { valid: true, checked: events.length, brokenAt: null, brokenAtTime: null };
}
