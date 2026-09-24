import { config } from '../../config';
import { prisma, tx } from '../../core/db';
import { mapPbsItem, PbsClient, type MappedPbsItem } from './pbs.client';

let client: PbsClient | null = null;
let running = false;

export const pbsConfigured = () => !!config.PBS_API_KEY;

export function pbsClient(): PbsClient | null {
  if (!config.PBS_API_KEY) return null;
  client ??= new PbsClient({ baseUrl: config.PBS_API_BASE_URL, subscriptionKey: config.PBS_API_KEY, minIntervalMs: config.PBS_API_MIN_INTERVAL_MS });
  return client;
}

/**
 * Mirror the current PBS Schedule locally, then refresh matching drug-master records
 * (maximum quantity, repeats and — where the schedule supplies it — DPMQ).
 * Idempotent: rerunning for the same schedule simply upserts.
 */
export async function syncPbsSchedule(opts: { maxPages?: number } = {}) {
  const pbs = pbsClient();
  if (!pbs) {
    await prisma.integrationRun.create({ data: { integration: 'PBS', status: 'SKIPPED', message: 'PBS_API_KEY is not configured — using the local catalogue', finishedAt: new Date() } });
    return { status: 'SKIPPED' as const, records: 0, drugsUpdated: 0 };
  }
  if (running) return { status: 'RUNNING' as const, records: 0, drugsUpdated: 0 };
  running = true;
  const run = await prisma.integrationRun.create({ data: { integration: 'PBS', status: 'RUNNING' } });
  try {
    const schedule = await pbs.currentSchedule();
    if (!schedule?.schedule_code) throw new Error('No current PBS schedule returned');
    const scheduleCode = String(schedule.schedule_code);

    let records = 0;
    let pages = 0;
    for await (const rows of pbs.paginate('items', { schedule_code: scheduleCode })) {
      const mapped = rows.map((r) => ({ item: mapPbsItem(r, scheduleCode), raw: r })).filter((x): x is { item: MappedPbsItem; raw: Record<string, unknown> } => !!x.item);
      await tx(async (db) => {
        for (const { item, raw } of mapped) {
          const data = { ...item, raw: JSON.stringify(raw), syncedAt: new Date() };
          await db.pbsItem.upsert({ where: { itemKey: item.itemKey }, create: data, update: data });
        }
      });
      records += mapped.length;
      if (opts.maxPages && ++pages >= opts.maxPages) break;
    }

    const drugsUpdated = await applyPbsToDrugMaster(scheduleCode);
    await prisma.integrationRun.update({
      where: { id: run.id },
      data: { status: 'SUCCESS', records, finishedAt: new Date(), message: `Schedule ${scheduleCode} (effective ${String(schedule.effective_date ?? 'n/a')}): ${records} items mirrored, ${drugsUpdated} drug records refreshed` },
    });
    return { status: 'SUCCESS' as const, scheduleCode, records, drugsUpdated };
  } catch (err) {
    await prisma.integrationRun.update({ where: { id: run.id }, data: { status: 'FAILED', message: (err as Error).message.slice(0, 500), finishedAt: new Date() } });
    return { status: 'FAILED' as const, records: 0, drugsUpdated: 0, error: (err as Error).message };
  } finally {
    running = false;
  }
}

/** Refresh drug-master fields from the mirror by PBS code. Local values are kept when the schedule has none. */
async function applyPbsToDrugMaster(scheduleCode: string) {
  const drugs = await prisma.drug.findMany({ where: { pbsCode: { not: null } } });
  let updated = 0;
  for (const d of drugs) {
    const item = await prisma.pbsItem.findFirst({ where: { pbsCode: d.pbsCode!, scheduleCode }, orderBy: { syncedAt: 'desc' } });
    if (!item) continue;
    const data = {
      maxQuantity: item.maxQuantity ?? d.maxQuantity,
      maxRepeats: item.repeats ?? d.maxRepeats,
      dpmq: item.dpmq ?? d.dpmq,
    };
    if (data.maxQuantity !== d.maxQuantity || data.maxRepeats !== d.maxRepeats || data.dpmq !== d.dpmq) {
      await prisma.drug.update({ where: { id: d.id }, data });
      updated++;
    }
  }
  return updated;
}

/** Look up a PBS code: local mirror first; live API only when the mirror has nothing. */
export async function lookupPbsCode(pbsCode: string) {
  const local = await prisma.pbsItem.findMany({ where: { pbsCode }, orderBy: { syncedAt: 'desc' }, take: 20 });
  if (local.length) return { source: 'MIRROR' as const, items: local.map(({ raw: _raw, ...i }) => i) };
  const pbs = pbsClient();
  if (!pbs) return { source: 'NONE' as const, items: [] };
  const schedule = await pbs.currentSchedule();
  const res = await pbs.get('items', { schedule_code: schedule?.schedule_code as string | undefined, pbs_code: pbsCode, limit: 50 });
  const items = (res.data ?? []).map((r) => mapPbsItem(r, String(schedule?.schedule_code ?? ''))).filter(Boolean);
  return { source: 'LIVE' as const, items };
}
