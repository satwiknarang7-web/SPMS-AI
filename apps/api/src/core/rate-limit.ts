import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config';

/**
 * Rate limiting.
 *
 *  • Global: RATE_LIMIT_MAX requests per RATE_LIMIT_WINDOW, keyed per signed-in user (so a
 *    whole pharmacy behind one NAT address is not throttled as one client) and per IP otherwise.
 *  • Auth endpoints: a much tighter budget per IP + email (see `authRateLimit`), on top of the
 *    account lockout after repeated failed passwords.
 *
 * Responses carry `x-ratelimit-*` headers and 429s use the standard error envelope with
 * `retry-after`. The in-memory store suits a single API instance; with several instances,
 * pass a shared store (e.g. Redis) via the plugin's `redis` option.
 */
export async function registerRateLimit(app: FastifyInstance) {
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
    keyGenerator: (req) => userKey(app, req),
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      code: 'RATE_LIMITED',
      error: 'Too Many Requests',
      message: `Too many requests — try again in ${ctx.after}.`,
    }),
  });
}

function userKey(app: FastifyInstance, req: FastifyRequest) {
  try {
    const header = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
    const token = header ?? req.cookies?.segue_at;
    if (token) {
      // Verified (not merely decoded) so a forged `sub` can't spread load across buckets.
      const claims = app.jwt.verify<{ sub: string }>(token);
      return `user:${claims.sub}`;
    }
  } catch {
    /* expired / invalid token: fall back to IP */
  }
  return `ip:${req.ip}`;
}

/**
 * Per-route config for sign-in style endpoints. Runs at `preHandler` (after body parsing) so
 * the key can include the submitted email.
 */
export function authRateLimit(keyGenerator: (req: FastifyRequest) => string, max = config.AUTH_RATE_LIMIT_MAX) {
  return { max, timeWindow: config.AUTH_RATE_LIMIT_WINDOW, keyGenerator, hook: 'preHandler' as const };
}
