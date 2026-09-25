'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, SearchInput } from '@/components/ui';
import { api } from '@/lib/api';

export interface Customer { id: string; name: string; phone: string | null }

export function CustomerSelect({ value, onChange }: { value: Customer | null; onChange: (c: Customer | null) => void }) {
  const [q, setQ] = useState('');
  const { data } = useQuery({ queryKey: ['pos', 'customers', q], queryFn: () => api.get<Customer[]>('/pos/customers', { q }), enabled: !value });
  if (value) return <div className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2 text-sm"><span className="font-medium">{value.name}</span><Button size="xs" variant="ghost" onClick={() => onChange(null)}>Change</Button></div>;
  return (
    <div>
      <SearchInput value={q} onChange={setQ} placeholder="Search customers" />
      <div className="mt-1 max-h-40 overflow-y-auto rounded-lg ring-1 ring-[var(--line)]">
        {data?.map((c) => <button key={c.id} onClick={() => onChange(c)} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-ink-50">{c.name} <span className="text-ink-400">{c.phone}</span></button>)}
      </div>
    </div>
  );
}

export function NeedShift() {
  return <Alert tone="amber" className="mb-4">Open a shift in <strong>Cash & balancing</strong> to take layby or hire payments.</Alert>;
}
