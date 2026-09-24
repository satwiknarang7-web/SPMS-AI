'use client';

import { date } from '@/lib/format';

export interface LabelData {
  number: string;
  quantity: number;
  directions: string;
  repeatsTotal: number;
  supplyNo: number;
  dispensedAt: string | null;
  checkedBy: string | null;
  patient: { firstName: string; lastName: string };
  prescriber: { name: string };
  drug: { brandName: string; genericName: string; strength: string; form: string; schedule: string | null };
  store: { name: string; suburb: string; state: string } | null;
}

/** Dispensing label, laid out at the common 80 × 40 mm label size. */
export function DispenseLabel({ s }: { s: LabelData }) {
  const repeatsLeft = Math.max(0, s.repeatsTotal - s.supplyNo);
  const initials = s.checkedBy?.split(' ').map((p) => p[0]).join('') ?? '';
  return (
    <div className="mx-auto w-[80mm] rounded-sm border border-ink-300 bg-white p-[3mm] font-sans text-[8.5pt] leading-tight text-black">
      <div className="flex items-baseline justify-between border-b border-black pb-[1mm]">
        <span className="text-[10pt] font-extrabold uppercase">{s.drug.brandName} {s.drug.strength}</span>
        <span className="font-semibold">Qty {s.quantity}</span>
      </div>
      <div className="mt-[0.5mm] text-[7pt]">{s.drug.genericName} {s.drug.form.toLowerCase()}</div>
      <div className="mt-[1.5mm] text-[10pt] font-bold uppercase">{s.directions}</div>
      <div className="mt-[1.5mm] flex justify-between">
        <span className="font-bold uppercase">{s.patient.firstName} {s.patient.lastName}</span>
        <span>{date(s.dispensedAt ?? new Date())}</span>
      </div>
      <div className="mt-[0.5mm] flex justify-between text-[7pt]">
        <span>{s.prescriber.name}</span>
        <span>Rx {s.number} · {repeatsLeft} rpt{repeatsLeft === 1 ? '' : 's'} left · {initials}</span>
      </div>
      {s.drug.schedule === 'S8' && <div className="mt-[1mm] text-[7pt] font-bold">CONTROLLED DRUG</div>}
      <div className="mt-[1.5mm] border-t border-black pt-[1mm] text-center text-[7pt] font-bold uppercase">Keep out of reach of children</div>
      <div className="text-center text-[6.5pt]">{s.store ? `${s.store.name}, ${s.store.suburb} ${s.store.state}` : ''}</div>
    </div>
  );
}
