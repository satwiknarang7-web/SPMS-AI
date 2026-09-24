'use client';

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { moneyCompact } from '@/lib/format';

const axis = { stroke: 'var(--color-ink-400)', fontSize: 11, tickLine: false, axisLine: false } as const;
const shortDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

function ChartTooltip({ active, payload, label, format }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; format: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-ink-900 px-3 py-2 text-xs text-white shadow-lg">
      {label && <div className="mb-1 text-ink-300">{/^\d{4}-\d{2}-\d{2}$/.test(label) ? shortDate(label) : label}</div>}
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 tnum">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-ink-300">{p.name}</span>
          <span className="ml-auto font-semibold">{format(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export interface Series {
  key: string;
  label: string;
  color: string;
}

export function TrendChart<T extends { date: string }>({ data, series, height = 260, format = moneyCompact, stacked }: { data: T[]; series: Series[]; height?: number; format?: (v: number) => string; stacked?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke="var(--color-ink-100)" vertical={false} />
        <XAxis dataKey="date" {...axis} tickFormatter={shortDate} minTickGap={24} />
        <YAxis {...axis} tickFormatter={(v) => format(v)} width={64} />
        <Tooltip content={<ChartTooltip format={format} />} />
        {series.map((s) => (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} fill={`url(#g-${s.key})`} stackId={stacked ? 'a' : undefined} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function BarsChart<T>({ data, xKey, series, height = 260, format = moneyCompact, layout = 'horizontal' }: { data: T[]; xKey: string; series: Series[]; height?: number; format?: (v: number) => string; layout?: 'horizontal' | 'vertical' }) {
  const vertical = layout === 'vertical';
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={vertical ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 8, left: vertical ? 8 : 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--color-ink-100)" vertical={!vertical ? false : true} horizontal={!vertical} />
        {vertical ? (
          <>
            <XAxis type="number" {...axis} tickFormatter={(v) => format(v)} />
            <YAxis type="category" dataKey={xKey} {...axis} width={140} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} {...axis} />
            <YAxis {...axis} tickFormatter={(v) => format(v)} width={64} />
          </>
        )}
        <Tooltip content={<ChartTooltip format={format} />} cursor={{ fill: 'var(--color-ink-50)' }} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={36} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export const PALETTE = ['#0a78c2', '#0fa89a', '#7c4dbd', '#f59e0b', '#e11d48', '#2aa9e0', '#1f9e6e', '#64748b', '#d946ef', '#84cc16'];

export function DonutChart({ data, height = 220, format = moneyCompact }: { data: { name: string; value: number }[]; height?: number; format?: (v: number) => string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="95%" paddingAngle={1.5} stroke="none">
              {data.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip format={format} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="text-[11px] text-ink-500">Total</div>
            <div className="text-lg font-bold text-ink-900 tnum">{format(total)}</div>
          </div>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
        {data.slice(0, 8).map((d, i) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="truncate text-ink-600">{d.name}</span>
            <span className="ml-auto font-medium text-ink-900 tnum">{total ? ((d.value / total) * 100).toFixed(0) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
