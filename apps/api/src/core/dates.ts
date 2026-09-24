/** Business dates are reported in the pharmacy's local time, not UTC. */
export const BUSINESS_TZ = process.env.BUSINESS_TZ ?? 'Australia/Sydney';

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** YYYY-MM-DD in the business time zone. */
export const dayKey = (d: Date) => fmt.format(d);

/** The last `n` business days (oldest first), ending today. */
export function lastDays(n: number, end = new Date()): string[] {
  return Array.from({ length: n }, (_, i) => dayKey(new Date(end.getTime() - (n - 1 - i) * 86_400_000)));
}
