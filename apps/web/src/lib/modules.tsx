'use client';

import { MODULES, type ModuleKey, type Permission } from '@segue/shared';
import {
  Activity, BarChart3, KeyRound, Boxes, Building2, ClipboardCheck, ClipboardList, CreditCard, FileSpreadsheet, FileText, History, Landmark, LayoutDashboard, ListOrdered,
  Megaphone, Network, Package, Pill, PlusCircle, Receipt, RefreshCw, ScanLine, ShieldCheck, ShoppingCart, Store, Tags, Truck, Users, Wallet, Wrench, type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  perm?: Permission[];
  end?: boolean;
}

export interface ModuleUi {
  key: ModuleKey;
  label: string;
  path: string;
  color: string;
  icon: LucideIcon;
  nav: NavItem[];
  /** Permissions that make the module's home page useful; used to pick a landing page. */
  home: Permission[];
}

export const MODULE_UI: Record<ModuleKey, ModuleUi> = {
  DISPENSE: {
    key: 'DISPENSE', label: 'Dispense', path: '/dispense', color: '#0a78c2', icon: Pill, home: ['dispense.scripts.read'],
    nav: [
      { to: '/dispense', label: 'Dashboard', icon: LayoutDashboard, end: true, perm: ['dispense.scripts.read'] },
      { to: '/dispense/new', label: 'New script', icon: PlusCircle, perm: ['dispense.scripts.write'] },
      { to: '/dispense/scripts', label: 'Script queue', icon: ListOrdered, perm: ['dispense.scripts.read'] },
      { to: '/dispense/patients', label: 'Patients', icon: Users, perm: ['dispense.patients.read'] },
      { to: '/dispense/reports', label: 'Reports', icon: BarChart3, perm: ['dispense.reports.read'] },
    ],
  },
  POS: {
    key: 'POS', label: 'POS', path: '/pos', color: '#0fa89a', icon: ShoppingCart, home: ['pos.sell'],
    nav: [
      { to: '/pos', label: 'Register', icon: ScanLine, end: true, perm: ['pos.sell'] },
      { to: '/pos/sales', label: 'Sales & returns', icon: Receipt, perm: ['pos.sell'] },
      { to: '/pos/shift', label: 'Cash & balancing', icon: Wallet, perm: ['pos.sell'] },
      { to: '/pos/laybys', label: 'Laybys', icon: ClipboardList, perm: ['pos.layby'] },
      { to: '/pos/hire', label: 'Equipment hire', icon: Wrench, perm: ['pos.hire'] },
    ],
  },
  OFFICE: {
    key: 'OFFICE', label: 'Office', path: '/office', color: '#1f9e6e', icon: Building2, home: ['office.reports.read', 'office.products.read'],
    nav: [
      { to: '/office', label: 'Dashboard', icon: LayoutDashboard, end: true, perm: ['office.reports.read'] },
      { to: '/office/products', label: 'Products', icon: Package, perm: ['office.products.read'] },
      { to: '/office/inventory', label: 'Inventory', icon: Boxes, perm: ['office.products.read'] },
      { to: '/office/orders', label: 'Purchasing', icon: Truck, perm: ['office.products.read'] },
      { to: '/office/suppliers', label: 'Suppliers', icon: Landmark, perm: ['office.products.read'] },
      { to: '/office/pricing', label: 'Pricing review', icon: Tags, perm: ['office.products.read'] },
      { to: '/office/accounts', label: 'Customer accounts', icon: CreditCard, perm: ['office.products.read'] },
      { to: '/office/stocktake', label: 'Stocktake', icon: ClipboardCheck, perm: ['office.products.read'] },
      { to: '/office/reports', label: 'Reports', icon: BarChart3, perm: ['office.reports.read'] },
    ],
  },
  HQ: {
    key: 'HQ', label: 'HQ', path: '/hq', color: '#2aa9e0', icon: Network, home: ['hq.reports.read', 'hq.config.read'],
    nav: [
      { to: '/hq', label: 'Group dashboard', icon: LayoutDashboard, end: true, perm: ['hq.reports.read'] },
      { to: '/hq/stores', label: 'Stores & groups', icon: Store, perm: ['hq.config.read'] },
      { to: '/hq/dispense-pricing', label: 'Dispense pricing', icon: Pill, perm: ['hq.config.read'] },
      { to: '/hq/drug-ranking', label: 'Drug ranking', icon: ListOrdered, perm: ['hq.config.read'] },
      { to: '/hq/retail-pricing', label: 'Retail pricing', icon: Tags, perm: ['hq.config.read'] },
      { to: '/hq/promotions', label: 'Promotions', icon: Megaphone, perm: ['hq.config.read'] },
      { to: '/hq/price-files', label: 'Supplier price files', icon: FileSpreadsheet, perm: ['hq.config.read'] },
      { to: '/hq/sync', label: 'Publishing & sync', icon: RefreshCw, perm: ['hq.config.read'] },
      { to: '/hq/reports', label: 'Reports', icon: FileText, perm: ['hq.reports.read'] },
      { to: '/hq/audit', label: 'Change log', icon: History, perm: ['hq.config.read'] },
    ],
  },
};

export const ADMIN_NAV: NavItem[] = [
  { to: '/admin/users', label: 'Users & roles', icon: Users, perm: ['platform.users.manage'] },
  { to: '/admin/licence', label: 'Licence & modules', icon: ShieldCheck },
  { to: '/admin/integrations', label: 'Integrations', icon: Activity },
  { to: '/admin/audit', label: 'Audit log', icon: History, perm: ['platform.audit.read'] },
  { to: '/admin/security', label: 'My sessions', icon: KeyRound },
];

/** Every permission that opens at least one page in the module. */
export const modulePermissions = (key: ModuleKey): Permission[] => [...new Set(MODULE_UI[key].nav.flatMap((i) => i.perm ?? []))];

/**
 * Whether a workspace belongs in the user's switcher. Unlicensed modules stay listed
 * (shown locked); licensed ones are hidden when the user's roles open none of their pages.
 */
export const showModule = (key: ModuleKey, hasModule: (m: ModuleKey) => boolean, canAny: (...p: Permission[]) => boolean) =>
  !hasModule(key) || canAny(...modulePermissions(key));

export const moduleInfo = (key: ModuleKey) => ({ ...MODULES[key], ...MODULE_UI[key] });
