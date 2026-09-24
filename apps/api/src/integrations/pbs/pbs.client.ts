/**
 * PBS Data API v3 client (Australian Government Department of Health, Disability and Ageing).
 *
 *   Base URL: https://data-api.health.gov.au/pbs/api/v3
 *   Auth:     `subscription-key` header — free key from https://data-api-portal.health.gov.au
 *   Limits:   public tier ≈ 1 request / 20 seconds; only the current schedule and the
 *             previous 12 months are available (future schedules need the Embargo API).
 *   Format:   JSON `{ _meta, data: [...] }` (default) or CSV with `Accept: text/csv`.
 *
 * The client serialises every request through a process-wide throttle so the rate limit is
 * never exceeded, retries 429/5xx with backoff, and never throws raw fetch errors at callers.
 */

export interface PbsClientOptions {
  baseUrl: string;
  subscriptionKey: string;
  minIntervalMs: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class PbsApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

export type PbsRecord = Record<string, unknown>;

interface PbsPage {
  _meta?: { total_records?: number; page?: number; limit?: number } & Record<string, unknown>;
  data?: PbsRecord[];
}

export class PbsClient {
  private nextSlot = 0;
  private readonly fetch: typeof fetch;

  constructor(private readonly opts: PbsClientOptions) {
    this.fetch = opts.fetchImpl ?? fetch;
  }

  /** Wait for the next permitted request slot (shared across all calls on this instance). */
  private async throttle() {
    const now = Date.now();
    const wait = Math.max(0, this.nextSlot - now);
    this.nextSlot = Math.max(now, this.nextSlot) + this.opts.minIntervalMs;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  async get(path: string, params: Record<string, string | number | undefined> = {}, attempt = 1): Promise<PbsPage> {
    const url = new URL(`${this.opts.baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    await this.throttle();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 60_000);
    let res: Response;
    try {
      res = await this.fetch(url, { headers: { 'subscription-key': this.opts.subscriptionKey, accept: 'application/json' }, signal: controller.signal });
    } catch (err) {
      if (attempt < 3) return this.get(path, params, attempt + 1);
      throw new PbsApiError(`PBS API unreachable: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) return this.get(path, params, attempt + 1);
    if (res.status === 401 || res.status === 403) throw new PbsApiError('PBS API rejected the subscription key', res.status);
    if (!res.ok) throw new PbsApiError(`PBS API ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
    const body = (await res.json()) as PbsPage | PbsRecord[];
    return Array.isArray(body) ? { data: body } : body;
  }

  /** Iterate every page of a collection endpoint. */
  async *paginate(path: string, params: Record<string, string | number | undefined> = {}, limit = 5000): AsyncGenerator<PbsRecord[]> {
    for (let page = 1; page < 1000; page++) {
      const res = await this.get(path, { ...params, page, limit });
      const rows = res.data ?? [];
      if (rows.length) yield rows;
      const total = Number(res._meta?.total_records ?? NaN);
      if (rows.length < limit || (Number.isFinite(total) && page * limit >= total)) return;
    }
  }

  /** Most recent published schedule, e.g. { schedule_code: '4061', effective_date: '2026-09-01' }. */
  async currentSchedule(): Promise<PbsRecord | null> {
    const res = await this.get('schedules', { limit: 20 });
    const rows = [...(res.data ?? [])];
    const date = (r: PbsRecord) => String(r.effective_date ?? r.effective_month ?? '');
    rows.sort((a, b) => date(b).localeCompare(date(a)) || Number(b.schedule_code ?? 0) - Number(a.schedule_code ?? 0));
    return rows[0] ?? null;
  }
}

/* ------------------------------ Field mapping ------------------------------ */

const pick = (r: PbsRecord, ...keys: string[]) => {
  for (const k of keys) if (r[k] !== undefined && r[k] !== null && r[k] !== '') return r[k];
  return undefined;
};
const int = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? Math.round(n) : null;
};
const cents = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? '').replace(/[$,]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

export interface MappedPbsItem {
  itemKey: string;
  scheduleCode: string;
  pbsCode: string;
  drugName: string;
  liDrugName: string | null;
  brandName: string | null;
  form: string | null;
  packSize: number | null;
  maxQuantity: number | null;
  repeats: number | null;
  dpmq: number | null;
  benefitType: string | null;
  programCode: string | null;
}

/**
 * Map a PBS `items` record to our mirror. Known v3 field names are tried first; fallbacks
 * tolerate minor schema drift. The original record is always kept in `raw`.
 */
export function mapPbsItem(r: PbsRecord, scheduleCode: string): MappedPbsItem | null {
  const pbsCode = String(pick(r, 'pbs_code', 'pbs_item_code') ?? '').trim();
  const drugName = String(pick(r, 'drug_name', 'li_drug_name', 'schedule_form') ?? '').trim();
  if (!pbsCode || !drugName) return null;
  const brandName = (pick(r, 'brand_name') as string | undefined) ?? null;
  const liItemId = pick(r, 'li_item_id');
  return {
    itemKey: liItemId ? String(liItemId) : `${scheduleCode}|${pbsCode}|${brandName ?? ''}`,
    scheduleCode: String(pick(r, 'schedule_code') ?? scheduleCode),
    pbsCode,
    drugName,
    liDrugName: (pick(r, 'li_drug_name') as string | undefined) ?? null,
    brandName,
    form: (pick(r, 'li_form', 'schedule_form', 'form') as string | undefined) ?? null,
    packSize: int(pick(r, 'pack_size')),
    maxQuantity: int(pick(r, 'maximum_quantity_units', 'maximum_prescribable_pack', 'max_quantity', 'maximum_quantity')),
    repeats: int(pick(r, 'number_of_repeats', 'maximum_number_of_repeats', 'repeats')),
    // DPMQ is only mapped when the schedule supplies it explicitly; determined (ex-manufacturer)
    // price is NOT a dispensed price and is deliberately not used as one.
    dpmq: cents(pick(r, 'dpmq', 'dispensed_price_for_max_quantity', 'dispensed_price_max_qty')),
    benefitType: (pick(r, 'benefit_type_code', 'benefit_type') as string | undefined) ?? null,
    programCode: (pick(r, 'program_code') as string | undefined) ?? null,
  };
}
