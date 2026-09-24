import path from 'node:path';
import type { NextConfig } from 'next';

/** Where the Segue API listens. The browser only ever talks to this Next.js origin. */
const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const repoRoot = path.resolve(process.cwd(), '../..');

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // The shared domain package is TypeScript source in the monorepo.
  transpilePackages: ['@segue/shared'],
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  /**
   * /api/* is proxied to the Fastify API, so auth cookies are same-origin (no CORS, SameSite
   * works) and the API URL never reaches the browser. Next forwards x-forwarded-for, which the
   * API trusts for per-IP rate limiting.
   */
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
