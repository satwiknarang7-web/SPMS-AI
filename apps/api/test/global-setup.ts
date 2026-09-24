import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

/**
 * Every test run gets its own brand-new SQLite file, created from the schema and seeded.
 * Nothing pre-existing is ever touched; the file is deleted afterwards.
 */
export default function setup() {
  const file = `test-${process.pid}-${Date.now()}.db`;
  const url = `file:./${file}`;
  process.env.DATABASE_URL = url;
  process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-0123456789';
  const env = { ...process.env, DATABASE_URL: url };
  execSync('npx prisma db push --skip-generate', { env, stdio: 'ignore' });
  execSync('npx tsx prisma/seed.ts', { env, stdio: 'ignore' });
  return () => {
    for (const f of [file, `${file}-journal`]) rmSync(path.join('prisma', f), { force: true });
  };
}
