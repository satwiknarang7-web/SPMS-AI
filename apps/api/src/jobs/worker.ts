import type { FastifyBaseLogger } from 'fastify';
import { runSync } from '../features/hq/sync/publication.service';
import { runDueReportSchedules } from '../features/hq/reports/reports.service';
import { prisma } from '../core/db';
import { pbsConfigured, syncPbsSchedule } from '../integrations/pbs/pbs.sync';
import { collectStoreMetrics } from './metrics';

/**
 * In-process background worker. In production these run as separate scheduled jobs
 * (e.g. a queue consumer), but the functions are the same and idempotent.
 */
export function startWorker(log: FastifyBaseLogger, intervalMs: number) {
  let running = false;
  let ticks = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const sync = await runSync();
      if (sync.activated || sync.applied || sync.failed) log.info({ sync }, 'sync pass');
      // Metrics every ~5 minutes; report schedules every ~minute.
      if (ticks % Math.max(1, Math.round(300_000 / intervalMs)) === 0) await collectStoreMetrics({ days: 2 });
      if (ticks % Math.max(1, Math.round(60_000 / intervalMs)) === 0) await runDueReportSchedules();
      // PBS schedule: refresh daily (the schedule itself changes monthly). Runs in the
      // background because the public API allows only ~3 requests a minute.
      if (pbsConfigured() && ticks % Math.max(1, Math.round(3_600_000 / intervalMs)) === 0) {
        const last = await prisma.integrationRun.findFirst({ where: { integration: 'PBS', status: 'SUCCESS' }, orderBy: { startedAt: 'desc' } });
        if (!last || Date.now() - last.startedAt.getTime() > 86_400_000) void syncPbsSchedule().then((r) => log.info({ pbs: r }, 'PBS schedule sync'));
      }
    } catch (err) {
      log.error(err, 'background worker error');
    } finally {
      ticks++;
      running = false;
    }
  };
  const handle = setInterval(tick, intervalMs);
  void tick();
  return () => clearInterval(handle);
}
