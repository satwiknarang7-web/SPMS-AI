import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import { config, isProd } from './config';
import { ACCESS_COOKIE } from './core/auth';
import { prisma } from './core/db';
import { registerErrorHandler } from './core/errors';
import { registerRateLimit } from './core/rate-limit';
import { dispenseModule } from './features/dispense';
import { hqModule } from './features/hq';
import { officeModule } from './features/office';
import { platformModule } from './features/platform';
import { authRoutes } from './features/platform/auth/auth.routes';
import { vendorRoutes } from './features/platform/vendor/vendor.routes';
import { posModule } from './features/pos';

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: isProd ? 'info' : 'warn', redact: ['req.headers.cookie', 'req.headers.authorization'] },
    trustProxy: true,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: config.WEB_ORIGIN.split(','), credentials: true, exposedHeaders: ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after'] });
  await app.register(cookie);
  // Access token from the httpOnly cookie (browsers) or `Authorization: Bearer` (agents, scripts).
  await app.register(jwt, { secret: config.JWT_SECRET, cookie: { cookieName: ACCESS_COOKIE, signed: false } });
  await registerRateLimit(app);
  registerErrorHandler(app);

  app.get('/api/health', { config: { rateLimit: false } }, async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', time: new Date().toISOString() };
  });

  // Platform services (not module-gated).
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(platformModule, { prefix: '/api/platform' });
  await app.register(vendorRoutes, { prefix: '/api/vendor' });

  // Purchasable modules — each module plugin enforces its licence once for all its features.
  await app.register(dispenseModule, { prefix: '/api/dispense' });
  await app.register(posModule, { prefix: '/api/pos' });
  await app.register(officeModule, { prefix: '/api/office' });
  await app.register(hqModule, { prefix: '/api/hq' });

  return app;
}
