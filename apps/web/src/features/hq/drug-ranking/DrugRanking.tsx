'use client';

import { useQuery } from '@tanstack/react-query';
import { ListOrdered, Send, Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PageBody } from '@/components/layout/AppShell';
import { Badge, Button, Card, Field, Loading, PageHeader, SearchInput, Select } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { useGroups } from '@/features/hq/shared/groups';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { money } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface DrugCfg { basis: string | null; drugs: { id: string; genericName: string; brandName: string; strength: string; form: string; drugClass: string | null; schedule: string | null; pbsCode: string | null; cost: number | null; flag: string | null }[] }

export function DrugRanking() {
  const { can } = useSession();
  const groups = useGroups();
  const [groupId, setGroupId] = useState('');
  const [q, setQ] = useState('');
  const [basis, setBasis] = useState<string>('');
  const [flags, setFlags] = useState<Record<string, string | null>>({});
  useEffect(() => { if (!groupId && groups.data?.[0]) setGroupId(groups.data[0].id); }, [groups.data, groupId]);
  const { data, isLoading } = useQuery({ queryKey: ['hq', 'drugcfg', groupId, q], queryFn: () => api.get<DrugCfg>('/hq/drug-config', { groupId, q }), enabled: !!groupId });
  useEffect(() => { setBasis(data?.basis ?? ''); setFlags({}); }, [data?.basis, groupId]);
  const changes = Object.entries(flags).filter(([id, f]) => (data?.drugs.find((d) => d.id === id)?.flag ?? null) !== f).map(([drugId, flag]) => ({ drugId, flag }));
  const basisChanged = (basis || null) !== (data?.basis ?? null);
  const publish = useAction(() => api.post('/hq/drug-config/publish', { groupId, basis: basisChanged ? basis || null : null, flags: changes }), { success: 'Drug configuration published to the group', invalidate: [['hq']], onSuccess: () => setFlags({}) });
  const editable = can('hq.drugconfig.write');
  const grouped = useMemo(() => {
    const m = new Map<string, DrugCfg['drugs']>();
    for (const d of data?.drugs ?? []) { const k = `${d.genericName} ${d.strength} ${d.form.toLowerCase()}`; m.set(k, [...(m.get(k) ?? []), d]); }
    return [...m.entries()];
  }, [data]);
  return (
    <PageBody wide>
      <PageHeader title="Drug configuration & ranking" subtitle="Control the order brands appear in store dispense search, and flag items as preferred, restricted or excluded"
        actions={editable && (changes.length > 0 || basisChanged) && <Button variant="primary" icon={<Send className="size-4" />} loading={publish.isPending} onClick={() => publish.mutate(undefined)}>Publish {changes.length + (basisChanged ? 1 : 0)} change(s)</Button>} />
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <Field label="Store group"><Select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="w-64">{groups.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></Field>
        <Field label="Ranking strategy">
          <Select value={basis} onChange={(e) => setBasis(e.target.value)} disabled={!editable} className="w-64">
            <option value="">Inherit / default (lowest cost)</option><option value="LOWEST_COST">Lowest cost</option><option value="HIGHEST_MARGIN">Highest margin</option><option value="STOCK_ON_HAND">Most stock on hand</option>
          </Select>
        </Field>
        <SearchInput value={q} onChange={setQ} placeholder="Filter medicines" className="w-64" />
      </div>
      {isLoading ? <Loading /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {grouped.map(([name, items]) => (
            <Card key={name} padded={false}>
              <div className="flex items-center gap-2 border-b border-ink-100 px-4 py-3"><ListOrdered className="size-4 text-[var(--accent)]" /><span className="font-semibold text-ink-900">{name}</span>{items[0]?.drugClass && <Badge>{items[0].drugClass}</Badge>}</div>
              <ul className="divide-y divide-ink-100">
                {items.map((d) => {
                  const flag = d.id in flags ? flags[d.id] : d.flag;
                  return (
                    <li key={d.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="flex-1"><span className="font-medium text-ink-900">{d.brandName}</span>{flag === 'PREFERRED' && <Star className="ml-1 inline size-3.5 fill-amber-400 text-amber-400" />}<span className="block text-xs text-ink-500">cost {money(d.cost)} {d.pbsCode && `· PBS ${d.pbsCode}`}</span></span>
                      <Select value={flag ?? ''} disabled={!editable} onChange={(e) => setFlags((f) => ({ ...f, [d.id]: e.target.value || null }))} className={cn('w-36', flag === 'EXCLUDED' && '[&]:text-rose-700', flag === 'PREFERRED' && '[&]:text-amber-700')}>
                        <option value="">No flag</option><option value="PREFERRED">Preferred</option><option value="RESTRICTED">Restricted</option><option value="EXCLUDED">Excluded</option>
                      </Select>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </PageBody>
  );
}
