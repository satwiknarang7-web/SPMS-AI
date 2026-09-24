/**
 * The four purchasable Segue workspaces. A tenant's subscriptions determine which
 * of these it may use; the API enforces this on every module route.
 */
export const MODULE_KEYS = ['DISPENSE', 'POS', 'OFFICE', 'HQ'] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface ModuleInfo {
  key: ModuleKey;
  name: string;
  /** Short label used in navigation, e.g. "Dispense". */
  short: string;
  tagline: string;
  description: string;
  /** Primary audience, used on the launcher. */
  audience: string;
  /** URL segment in the web app and API. */
  path: string;
}

export const MODULES: Record<ModuleKey, ModuleInfo> = {
  DISPENSE: {
    key: 'DISPENSE',
    name: 'Segue Dispense',
    short: 'Dispense',
    tagline: 'Smarter, faster and safer dispensing.',
    description:
      'Prescription intake, eRx tokens, clinical safety checks, PBS pricing, final check and labelling — with a complete script audit.',
    audience: 'Pharmacists & dispensary technicians',
    path: 'dispense',
  },
  POS: {
    key: 'POS',
    name: 'Segue POS',
    short: 'POS',
    tagline: 'Simplified transactions, faster service.',
    description:
      'Touch-first checkout with script pickup, multi-tender payments, PBS-aware surcharging, margin protection and X/Z/ZZ balancing.',
    audience: 'Cashiers & pharmacy assistants',
    path: 'pos',
  },
  OFFICE: {
    key: 'OFFICE',
    name: 'Segue Office',
    short: 'Office',
    tagline: 'Operations, profitability and performance in one console.',
    description:
      'Products, inventory, suppliers, purchasing, goods receiving, pricing review, customer accounts, stocktake and store reporting.',
    audience: 'Store managers & owners',
    path: 'office',
  },
  HQ: {
    key: 'HQ',
    name: 'Segue HQ',
    short: 'HQ',
    tagline: 'Centralise pricing, reporting and operations across every store.',
    description:
      'Store groups, central dispense and retail pricing, drug ranking, promotions, supplier price files, sync and group analytics.',
    audience: 'Head office of a pharmacy group',
    path: 'hq',
  },
};

export const isModuleKey = (value: unknown): value is ModuleKey =>
  typeof value === 'string' && (MODULE_KEYS as readonly string[]).includes(value);

export const SUBSCRIPTION_STATUSES = ['ACTIVE', 'TRIAL', 'SUSPENDED', 'EXPIRED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface SubscriptionLike {
  module: string;
  status: string;
  expiresAt: Date | string | null;
}

/** A subscription grants access when it is ACTIVE/TRIAL and not past its expiry. */
export function isSubscriptionUsable(sub: SubscriptionLike, now: Date = new Date()): boolean {
  if (sub.status !== 'ACTIVE' && sub.status !== 'TRIAL') return false;
  if (sub.expiresAt == null) return true;
  return new Date(sub.expiresAt).getTime() > now.getTime();
}

export function licensedModules(subs: SubscriptionLike[], now: Date = new Date()): ModuleKey[] {
  return MODULE_KEYS.filter((key) => subs.some((s) => s.module === key && isSubscriptionUsable(s, now)));
}
