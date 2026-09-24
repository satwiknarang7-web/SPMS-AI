import { buildApp } from './app';
import { config } from './config';
import { prisma } from './core/db';
import { startWorker } from './jobs/worker';

const app = await buildApp();
const stopWorker = startWorker(app.log, config.SYNC_INTERVAL_MS);

const shutdown = async (signal: string) => {
  app.log.warn(`${signal} received — shutting down`);
  stopWorker();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(`
Port ${config.PORT} is already in use — another Segue API (or other app) is running.
Stop it, or set PORT in apps/api/.env.
`);
  } else {
    console.error(err);
  }
  stopWorker();
  await prisma.$disconnect();
  process.exit(1);
}
console.log(`Segue API listening on http://localhost:${config.PORT}`);
