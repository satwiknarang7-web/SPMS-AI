import { prisma } from '../core/db';
import { pbsConfigured } from './pbs/pbs.sync';

/**
 * External integrations required for Australian pharmacy operation. Each is an adapter at
 * the platform edge, so an outage in one never compromises dispensing or checkout.
 *
 * Only the PBS Data API is live in this release. The rest are ON_HOLD pending credentials
 * (PRODA, HI/NASH PKI certificates, vendor agreements); their adapters are stubbed and the
 * corresponding workflows use local data (e.g. the built-in interaction rules, the
 * simulated eRx token exchange).
 */
export interface IntegrationInfo {
  key: string;
  name: string;
  category: string;
  purpose: string;
  prerequisites: string;
  usedBy: string[];
  status: 'CONNECTED' | 'NOT_CONFIGURED' | 'ON_HOLD';
  fallback: string;
}

const CATALOGUE: Omit<IntegrationInfo, 'status'>[] = [
  { key: 'PBS', name: 'PBS Public API (v3)', category: 'Schedule & pricing', purpose: 'PBS item codes, maximum quantities, repeats and subsidy pricing, refreshed monthly.', prerequisites: 'Free subscription key from the PBS Data API portal (PBS_API_KEY).', usedBy: ['Dispense', 'HQ'], fallback: 'Local drug master (seeded PBS data)' },
  { key: 'PBS_EMBARGO', name: 'PBS Embargo API', category: 'Schedule & pricing', purpose: 'Schedule changes ~2 weeks before public release, for pricing preparation.', prerequisites: 'Embargo access agreement with the Department of Health.', usedBy: ['HQ'], fallback: 'Public schedule on release day' },
  { key: 'ERX', name: 'eRx Script Exchange / PDS', category: 'Electronic prescribing', purpose: 'Retrieve electronic prescriptions by token barcode / QR scan.', prerequisites: 'Conformance testing, HI/NASH PKI certificates, PDS registration.', usedBy: ['Dispense', 'POS'], fallback: 'Simulated token exchange (demo tokens)' },
  { key: 'ASL', name: 'Active Script List', category: 'Electronic prescribing', purpose: "All of a patient's active electronic scripts without individual tokens.", prerequisites: 'PDS connection and patient consent workflow.', usedBy: ['Dispense'], fallback: 'Simulated ASL from demo tokens' },
  { key: 'MIMS', name: 'MIMS / AMH / APF', category: 'Clinical reference', purpose: 'Interaction, contraindication, dosage and formulary checks.', prerequisites: 'Commercial licence with the clinical content provider.', usedBy: ['Dispense'], fallback: 'Built-in interaction rules (limited demo knowledge base)' },
  { key: 'DDBOOK', name: 'DD Book (DD Cloud)', category: 'Controlled substances', purpose: 'Electronic Schedule 8 register: balances, reconciliation, audits.', prerequisites: 'Vendor API agreement.', usedBy: ['Dispense'], fallback: 'S8 alert at final check; supply recorded in the script audit' },
  { key: 'METHDA', name: 'MethDA', category: 'Controlled substances', purpose: 'Opioid pharmacotherapy / staged supply dosing and compliance.', prerequisites: 'Vendor API agreement.', usedBy: ['Dispense'], fallback: 'Not available' },
  { key: 'MHR', name: 'My Health Record', category: 'National digital health', purpose: 'Read health summaries; upload dispense records.', prerequisites: 'PRODA, HPI-O, NASH certificate, conformance.', usedBy: ['Dispense'], fallback: 'Not available' },
  { key: 'HI', name: 'HI Service', category: 'National digital health', purpose: 'Validate patient IHI, clinician HPI-I and facility HPI-O.', prerequisites: 'PRODA, HI Service registration, NASH certificate.', usedBy: ['Dispense', 'Platform'], fallback: 'Medicare number format validation only' },
];

export async function integrationStatus() {
  const last = await prisma.integrationRun.findMany({ orderBy: { startedAt: 'desc' }, take: 50 });
  const [pbsItems, pbsLastSuccess] = await Promise.all([
    prisma.pbsItem.count(),
    prisma.integrationRun.findFirst({ where: { integration: 'PBS', status: 'SUCCESS' }, orderBy: { startedAt: 'desc' } }),
  ]);
  return CATALOGUE.map((c) => {
    const status: IntegrationInfo['status'] = c.key === 'PBS' ? (pbsConfigured() ? 'CONNECTED' : 'NOT_CONFIGURED') : 'ON_HOLD';
    const lastRun = last.find((r) => r.integration === c.key) ?? null;
    return {
      ...c,
      status,
      lastRun,
      ...(c.key === 'PBS' ? { mirroredItems: pbsItems, lastSuccessAt: pbsLastSuccess?.finishedAt ?? null } : {}),
    };
  });
}
