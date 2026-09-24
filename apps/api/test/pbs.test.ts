import { describe, expect, it } from 'vitest';
import { mapPbsItem, PbsApiError, PbsClient } from '../src/integrations/pbs/pbs.client';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('PBS Data API client', () => {
  it('sends the subscription key, paginates, and throttles requests', async () => {
    const calls: { url: string; key: string | null; at: number }[] = [];
    const fetchImpl = (async (input: URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url: url.toString(), key: new Headers(init?.headers).get('subscription-key'), at: Date.now() });
      const page = Number(url.searchParams.get('page'));
      return json({ _meta: { total_records: 3 }, data: page === 1 ? [{ pbs_code: '1' }, { pbs_code: '2' }] : [{ pbs_code: '3' }] });
    }) as unknown as typeof fetch;
    const client = new PbsClient({ baseUrl: 'https://example.test/pbs/api/v3', subscriptionKey: 'k', minIntervalMs: 50, fetchImpl });

    const pages: unknown[][] = [];
    for await (const rows of client.paginate('items', { schedule_code: '4061' }, 2)) pages.push(rows);
    expect(pages.map((p) => p.length)).toEqual([2, 1]);
    expect(calls[0]!.key).toBe('k');
    expect(calls[0]!.url).toContain('schedule_code=4061');
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(45);
  });

  it('retries server errors and reports rejected keys clearly', async () => {
    let n = 0;
    const flaky = (async () => (++n < 2 ? json({}, 503) : json({ data: [{ schedule_code: '4061', effective_date: '2026-09-01' }] }))) as unknown as typeof fetch;
    const c1 = new PbsClient({ baseUrl: 'https://example.test', subscriptionKey: 'k', minIntervalMs: 1, fetchImpl: flaky });
    expect((await c1.currentSchedule())?.schedule_code).toBe('4061');

    const denied = (async () => json({}, 401)) as unknown as typeof fetch;
    const c2 = new PbsClient({ baseUrl: 'https://example.test', subscriptionKey: 'bad', minIntervalMs: 1, fetchImpl: denied });
    await expect(c2.get('schedules')).rejects.toBeInstanceOf(PbsApiError);
  });

  it('maps v3 item fields without treating determined price as DPMQ', () => {
    const m = mapPbsItem({ li_item_id: 'X1', pbs_code: '8215K', drug_name: 'Atorvastatin', brand_name: 'Lipitor', pack_size: '30', maximum_quantity_units: 30, number_of_repeats: '5', determined_price: '12.34', benefit_type_code: 'U' }, '4061');
    expect(m).toMatchObject({ itemKey: 'X1', pbsCode: '8215K', packSize: 30, maxQuantity: 30, repeats: 5, dpmq: null, benefitType: 'U' });
    expect(mapPbsItem({ drug_name: 'no code' }, '4061')).toBeNull();
  });
});
