import { ROLES } from '@segue/shared';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFrom, audit } from '../../../core/audit';
import { requirePermission, revokeAllSessions, tenantOf } from '../../../core/auth';
import { prisma, tx } from '../../../core/db';
import { badRequest, conflict, forbidden, notFound, parse } from '../../../core/errors';

const roleGrant = z.object({ role: z.enum(ROLES), storeId: z.string().nullable() });

const userCreate = z.object({
  name: z.string().min(2),
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(10, 'Password must be at least 10 characters'),
  roles: z.array(roleGrant).min(1),
});

const userUpdate = z.object({
  name: z.string().min(2).optional(),
  isActive: z.boolean().optional(),
  roles: z.array(roleGrant).min(1).optional(),
  password: z.string().min(10).optional(),
});

export async function usersRoutes(app: FastifyInstance) {
  app.get('/users', { preHandler: requirePermission('platform.users.manage') }, async (req) => {
    const tenantId = tenantOf(req);
    const users = await prisma.user.findMany({ where: { tenantId }, include: { roles: true }, orderBy: { name: 'asc' } });
    return users.map(({ passwordHash: _omit, ...u }) => u);
  });

  app.post('/users', { preHandler: requirePermission('platform.users.manage') }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(userCreate, req.body);
    await assertGrantable(req.ctx.roles.includes('GROUP_ADMIN') || req.ctx.roles.includes('SYSTEM_ADMIN'), tenantId, body.roles, req.ctx.storeId);
    if (await prisma.user.findUnique({ where: { email: body.email } })) throw conflict('A user with that email already exists');
    const passwordHash = await bcrypt.hash(body.password, 12);
    return tx(async (db) => {
      const user = await db.user.create({
        data: { tenantId, name: body.name, email: body.email, passwordHash, roles: { create: body.roles } },
        include: { roles: true },
      });
      await audit(db, actorFrom(req), {
        module: 'PLATFORM', action: 'user.create', entityType: 'User', entityId: user.id,
        summary: `Created user ${user.name}`, after: { email: user.email, roles: body.roles },
      });
      const { passwordHash: _omit, ...safe } = user;
      return safe;
    });
  });

  app.patch<{ Params: { id: string } }>('/users/:id', { preHandler: requirePermission('platform.users.manage') }, async (req) => {
    const tenantId = tenantOf(req);
    const body = parse(userUpdate, req.body);
    const existing = await prisma.user.findFirst({ where: { id: req.params.id, tenantId }, include: { roles: true } });
    if (!existing) throw notFound('User');
    if (existing.id === req.ctx.userId && body.isActive === false) throw badRequest('You cannot deactivate your own account');
    if (body.roles) await assertGrantable(req.ctx.roles.includes('GROUP_ADMIN') || req.ctx.roles.includes('SYSTEM_ADMIN'), tenantId, body.roles, req.ctx.storeId);
    return tx(async (db) => {
      if (body.roles) {
        await db.userRole.deleteMany({ where: { userId: existing.id } });
        await db.userRole.createMany({ data: body.roles.map((r) => ({ ...r, userId: existing.id })) });
      }
      const user = await db.user.update({
        where: { id: existing.id },
        data: {
          name: body.name,
          isActive: body.isActive,
          // A password reset also clears any sign-in lockout.
          ...(body.password ? { passwordHash: await bcrypt.hash(body.password, 12), failedLoginCount: 0, lockedUntil: null } : {}),
        },
        include: { roles: true },
      });
      await audit(db, actorFrom(req), {
        module: 'PLATFORM', action: 'user.update', entityType: 'User', entityId: user.id, summary: `Updated user ${user.name}`,
        before: { name: existing.name, isActive: existing.isActive, roles: existing.roles.map((r) => ({ role: r.role, storeId: r.storeId })) },
        after: { name: user.name, isActive: user.isActive, roles: user.roles.map((r) => ({ role: r.role, storeId: r.storeId })), passwordReset: !!body.password },
      });
      const { passwordHash: _omit, ...safe } = user;
      // Deactivation or a password reset signs the user out of every device immediately.
      if (body.isActive === false || body.password) await revokeAllSessions(user.id, body.isActive === false ? 'USER_DEACTIVATED' : 'PASSWORD_RESET', undefined, db);
      return safe;
    });
  });
}

/**
 * Prevent privilege escalation: store managers may only grant store-level roles for their
 * own store; tenant-wide and HQ roles need a group or system administrator.
 */
async function assertGrantable(isTenantAdmin: boolean, tenantId: string, roles: z.infer<typeof roleGrant>[], currentStoreId: string | null) {
  const storeIds = roles.map((r) => r.storeId).filter((s): s is string => !!s);
  if (storeIds.length) {
    const count = await prisma.store.count({ where: { tenantId, id: { in: storeIds } } });
    if (count !== new Set(storeIds).size) throw badRequest('Unknown store in role grant');
  }
  if (isTenantAdmin) return;
  const storeRoles = new Set(['PHARMACIST', 'DISPENSARY_TECHNICIAN', 'PHARMACY_ASSISTANT', 'STORE_MANAGER']);
  for (const r of roles) {
    if (!storeRoles.has(r.role) || r.storeId !== currentStoreId) {
      throw forbidden('Store managers can only grant store roles for their own store');
    }
  }
}
