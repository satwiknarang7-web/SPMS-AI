'use client';

import { type ModuleKey, MODULES } from '@segue/shared';
import { Check, Lock, Mail } from 'lucide-react';
import { PageBody } from '@/components/layout/AppShell';
import { ProductMark } from '@/components/layout/Brand';
import { Button, Card } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { date } from '@/lib/format';
import { MODULE_UI } from '@/lib/modules';

export const HIGHLIGHTS: Record<ModuleKey, string[]> = {
  DISPENSE: ['eRx tokens and Active Script List', 'Allergy, interaction and duplicate-therapy checks', 'PBS co-payment and safety net pricing', 'Final check with barcode scan verification', 'Tamper-evident script audit'],
  POS: ['Script pickup straight from Dispense', 'Split tenders with PBS-exempt surcharging', 'Margin protection on discounts', 'Layby and equipment hire', 'X, Z and ZZ balancing'],
  OFFICE: ['Real-time stock across Dispense and POS', 'Purchasing and goods receiving', 'Auditable pricing review', 'Customer accounts and statements', 'Stocktake with variance posting'],
  HQ: ['Store groups with deterministic precedence', 'Central dispense and retail pricing', 'Supplier price file approval', 'Queued, retried store sync with rollback', 'De-identified group analytics'],
};

export function LockedModule({ module }: { module: ModuleKey }) {
  const { session } = useSession();
  const ui = MODULE_UI[module];
  const sub = session?.subscriptions.find((s) => s.module === module);
  return (
    <div>
      <PageBody>
        <Card className="mx-auto max-w-3xl overflow-hidden" padded={false}>
          <div className="px-10 py-10" style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${ui.color} 9%, white), white 70%)` }}>
            <div className="flex items-start justify-between gap-4">
              <ProductMark module={ui.label} color={ui.color} size="lg" />
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-ink-700 shadow-sm">
                <Lock className="size-3.5" /> {sub ? `Licence ${sub.status.toLowerCase()}${sub.expiresAt ? ` · ${date(sub.expiresAt)}` : ''}` : 'Not included in your plan'}
              </span>
            </div>
            <p className="mt-6 max-w-xl text-lg text-ink-700">{MODULES[module].tagline}</p>
          </div>
          <div className="grid gap-8 border-t border-[var(--line)] px-10 py-8 md:grid-cols-[1fr_auto]">
            <ul className="space-y-2.5">
              {HIGHLIGHTS[module].map((h) => (
                <li key={h} className="flex items-start gap-2.5 text-sm text-ink-700">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${ui.color} 12%, white)`, color: ui.color }}>
                    <Check className="size-3" />
                  </span>
                  {h}
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-2 md:w-56">
              <a href={`mailto:sales@segue.example?subject=${encodeURIComponent(`${MODULES[module].name} for ${session?.tenant?.name ?? ''}`)}`}>
                <Button variant="primary" size="lg" className="w-full" icon={<Mail className="size-4" />}>
                  {sub ? 'Renew licence' : 'Talk to Segue'}
                </Button>
              </a>
              <p className="text-xs text-ink-500">Modules are licensed per organisation. Once activated, access is available immediately — no reinstall.</p>
            </div>
          </div>
        </Card>
      </PageBody>
    </div>
  );
}
