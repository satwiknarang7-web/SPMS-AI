import type { ModuleKey, Permission } from '@segue/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, forbidden } from '../errors';

type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

/** Backend licence enforcement: the tenant must hold a usable subscription for the module. */
export function requireModule(module: ModuleKey): Guard {
  return async (req) => {
    if (!req.ctx.modules.includes(module)) {
      throw new AppError(403, 'MODULE_NOT_LICENSED', `Your organisation does not have an active ${module} subscription.`, { module });
    }
  };
}

export function requirePermission(...perms: Permission[]): Guard {
  return async (req) => {
    const missing = perms.filter((p) => !req.ctx.permissions.has(p));
    if (missing.length) throw forbidden(`Missing permission: ${missing.join(', ')}`);
  };
}

export function requireAnyPermission(...perms: Permission[]): Guard {
  return async (req) => {
    if (!perms.some((p) => req.ctx.permissions.has(p))) throw forbidden();
  };
}

export async function requirePlatformAdmin(req: FastifyRequest) {
  if (!req.ctx.isPlatformAdmin) throw forbidden('Segue platform administrators only');
}

export function tenantOf(req: FastifyRequest): string {
  if (!req.ctx.tenantId) throw forbidden('This action requires an organisation account');
  return req.ctx.tenantId;
}

export function storeOf(req: FastifyRequest): string {
  if (!req.ctx.storeId) throw new AppError(400, 'NO_STORE_SELECTED', 'Select a store to continue');
  return req.ctx.storeId;
}

export const hasPermission = (req: FastifyRequest, p: Permission) => req.ctx.permissions.has(p);
