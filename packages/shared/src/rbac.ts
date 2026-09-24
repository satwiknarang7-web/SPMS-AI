import type { ModuleKey } from './modules';

/**
 * Role-based access control. Access is evaluated as
 *   role permissions ∩ modules the tenant has licensed ∩ store scope.
 * Clinical access is deliberately kept apart from retail and administrative access.
 */
export const ROLES = [
  'PHARMACIST',
  'DISPENSARY_TECHNICIAN',
  'PHARMACY_ASSISTANT',
  'STORE_MANAGER',
  'GROUP_ADMIN',
  'PRICING_MANAGER',
  'CATEGORY_MANAGER',
  'REPORTING_USER',
  'SYSTEM_ADMIN',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  PHARMACIST: 'Pharmacist',
  DISPENSARY_TECHNICIAN: 'Dispensary Technician',
  PHARMACY_ASSISTANT: 'Pharmacy Assistant',
  STORE_MANAGER: 'Store Manager',
  GROUP_ADMIN: 'Group Administrator',
  PRICING_MANAGER: 'Pricing Manager',
  CATEGORY_MANAGER: 'Category Manager',
  REPORTING_USER: 'Reporting User',
  SYSTEM_ADMIN: 'System Administrator',
};

export const PERMISSIONS = [
  // Dispense
  'dispense.patients.read',
  'dispense.patients.write',
  'dispense.prescribers.write',
  'dispense.scripts.read',
  'dispense.scripts.write',
  'dispense.scripts.check',
  'dispense.reports.read',
  // POS
  'pos.sell',
  'pos.refund',
  'pos.discount.override',
  'pos.shift.manage',
  'pos.layby',
  'pos.hire',
  // Office
  'office.products.read',
  'office.products.write',
  'office.inventory.adjust',
  'office.suppliers.write',
  'office.purchasing.write',
  'office.pricing.write',
  'office.accounts.write',
  'office.stocktake.write',
  'office.reports.read',
  // HQ
  'hq.config.read',
  'hq.stores.manage',
  'hq.pricing.write',
  'hq.drugconfig.write',
  'hq.promotions.write',
  'hq.pricefiles.write',
  'hq.publish',
  'hq.reports.read',
  // Platform (not tied to a purchasable module)
  'platform.users.manage',
  'platform.audit.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const PREFIX_TO_MODULE: Record<string, ModuleKey | null> = {
  dispense: 'DISPENSE',
  pos: 'POS',
  office: 'OFFICE',
  hq: 'HQ',
  platform: null,
};

/** The module a permission belongs to, or null for platform permissions. */
export function permissionModule(permission: Permission): ModuleKey | null {
  const prefix = permission.split('.')[0] ?? '';
  return PREFIX_TO_MODULE[prefix] ?? null;
}

const all = (prefix: string): Permission[] => PERMISSIONS.filter((p) => p.startsWith(`${prefix}.`));

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  PHARMACIST: [...all('dispense'), 'pos.sell', 'office.products.read'],
  DISPENSARY_TECHNICIAN: [
    'dispense.patients.read',
    'dispense.patients.write',
    'dispense.prescribers.write',
    'dispense.scripts.read',
    'dispense.scripts.write',
    'office.products.read',
  ],
  PHARMACY_ASSISTANT: ['pos.sell', 'pos.layby', 'pos.hire', 'office.products.read'],
  STORE_MANAGER: [...all('pos'), ...all('office'), 'dispense.reports.read', 'hq.config.read', 'platform.users.manage', 'platform.audit.read'],
  GROUP_ADMIN: [...all('hq'), 'office.products.read', 'office.reports.read', 'platform.users.manage', 'platform.audit.read'],
  PRICING_MANAGER: ['hq.config.read', 'hq.pricing.write', 'hq.promotions.write', 'hq.pricefiles.write', 'hq.publish', 'hq.reports.read', 'office.products.read'],
  CATEGORY_MANAGER: ['hq.config.read', 'hq.drugconfig.write', 'hq.publish', 'hq.reports.read', 'office.products.read'],
  REPORTING_USER: ['hq.config.read', 'hq.reports.read'],
  SYSTEM_ADMIN: ['platform.users.manage', 'platform.audit.read', 'office.products.read'],
};

export function permissionsForRoles(roles: readonly Role[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const role of roles) for (const p of ROLE_PERMISSIONS[role] ?? []) out.add(p);
  return out;
}

/**
 * Effective permissions = what the user's roles grant, restricted to modules the
 * tenant has actually licensed. Platform permissions are never module-gated.
 */
export function effectivePermissions(roles: readonly Role[], licensed: readonly ModuleKey[]): Permission[] {
  const licensedSet = new Set(licensed);
  return [...permissionsForRoles(roles)].filter((p) => {
    const mod = permissionModule(p);
    return mod === null || licensedSet.has(mod);
  });
}

export const isRole = (value: unknown): value is Role => typeof value === 'string' && (ROLES as readonly string[]).includes(value);
