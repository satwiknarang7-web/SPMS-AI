import { z } from 'zod';

try {
  process.loadEnvFile?.();
} catch {
  // No .env file — rely on the real environment.
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  PORT: z.coerce.number().int().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  SYNC_INTERVAL_MS: z.coerce.number().int().min(1000).default(15000),
  // Auth: short-lived access token, rotating refresh token, absolute session lifetime.
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(30).default(900),
  REFRESH_TOKEN_TTL_HOURS: z.coerce.number().min(1).default(12),
  SESSION_MAX_DAYS: z.coerce.number().min(1).default(7),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).default(5),
  LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),
  // Rate limiting (per user when signed in, otherwise per IP).
  RATE_LIMIT_MAX: z.coerce.number().int().min(10).default(300),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  AUTH_RATE_LIMIT_WINDOW: z.string().default('15 minutes'),
  // PBS Data API v3 — free key from https://data-api-portal.health.gov.au (optional).
  PBS_API_KEY: z.string().optional().transform((v) => v || undefined),
  PBS_API_BASE_URL: z.string().url().default('https://data-api.health.gov.au/pbs/api/v3'),
  PBS_API_MIN_INTERVAL_MS: z.coerce.number().int().min(3000).default(21000),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', z.prettifyError(parsed.error));
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === 'production';
