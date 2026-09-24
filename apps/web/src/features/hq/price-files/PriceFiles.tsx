'use client';

import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageBody } from '@/components/layout/AppShell';
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, Loading, PageHeader, Select, StatusBadge, Table, TD, TH, THead, TR } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { api } from '@/lib/api';
import { dateTime, dollars } from '@/lib/format';
import { useAction } from '@/lib/hooks';

export interface PriceFileRow { id: string; fileName: string; status: string; createdAt: string; supplier: { name: string }; summary: Record<string, number> }

export function PriceFiles() {
  const router = useRouter();
  const { can } = useSession();
  const [uploading, setUploading] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['hq', 'pricefiles'], queryFn: () => api.get<PriceFileRow[]>('/hq/pricefiles') });
  return (
    <PageBody>
      <PageHeader title="Supplier price files" subtitle="Upload, validate, review outliers and approve before prices reach stores" actions={can('hq.pricefiles.write') && <Button variant="primary" icon={<Upload className="size-4" />} onClick={() => setUploading(true)}>Upload price file</Button>} />
      <Card padded={false}>
        {isLoading ? <Loading /> : !data?.length ? <EmptyState icon={<FileSpreadsheet />} title="No price files yet" /> : (
          <Table>
            <THead><tr><TH>File</TH><TH>Supplier</TH><TH>Uploaded</TH><TH>Validation</TH><TH>Status</TH></tr></THead>
            <tbody>
              {data.map((f) => (
                <TR key={f.id} onClick={() => router.push(`/hq/price-files/${f.id}`)}>
                  <TD className="font-medium text-ink-900">{f.fileName}</TD>
                  <TD>{f.supplier.name}</TD>
                  <TD className="text-ink-500">{dateTime(f.createdAt)}</TD>
                  <TD><div className="flex flex-wrap gap-1">{f.summary.OK && <Badge tone="green">{f.summary.OK} ok</Badge>}{f.summary.OUTLIER && <Badge tone="amber">{f.summary.OUTLIER} outliers</Badge>}{f.summary.UNMATCHED && <Badge tone="red">{f.summary.UNMATCHED} unmatched</Badge>}{f.summary.ERROR && <Badge tone="red">{f.summary.ERROR} errors</Badge>}</div></TD>
                  <TD><StatusBadge status={f.status} label={f.status === 'VALIDATED' ? 'Awaiting approval' : undefined} /></TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <UploadDialog open={uploading} onClose={() => setUploading(false)} />
    </PageBody>
  );
}

export function UploadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const suppliers = useQuery({ queryKey: ['hq', 'suppliers'], queryFn: () => api.get<{ id: string; name: string }[]>('/hq/suppliers'), enabled: open });
  const [supplierId, setSupplierId] = useState('');
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [outlier, setOutlier] = useState('20');
  useEffect(() => { if (open) { setFile(null); setSupplierId(''); } }, [open]);
  const upload = useAction(() => api.post<{ id: string }>('/hq/pricefiles', { supplierId, fileName: file!.name, content: file!.content, outlierPct: Number(outlier) }), { success: 'File validated — review before approving', invalidate: [['hq', 'pricefiles']], onSuccess: (f) => { onClose(); router.push(`/hq/price-files/${f.id}`); } });
  return (
    <Dialog open={open} onClose={onClose} title="Upload supplier price file" description="Release 1 format: CSV with columns barcode, supplier_code, description, cost, retail (dollars, retail inc GST)."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!supplierId || !file} loading={upload.isPending} onClick={() => upload.mutate(undefined)}>Upload & validate</Button></>}>
      <div className="grid gap-4">
        <Field label="Supplier"><Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Select…</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <div>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setFile({ name: f.name, content: await f.text() }); }} />
          <button onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-ink-300 p-8 text-sm text-ink-500 hover:border-[var(--accent)] hover:text-ink-700">
            <FileSpreadsheet className="size-8" />
            {file ? <span className="font-medium text-ink-900">{file.name} · {file.content.split('\n').length - 1} rows</span> : 'Choose a CSV file'}
          </button>
        </div>
        <Field label="Outlier threshold (%)" hint="Cost movements larger than this need explicit review"><Input value={outlier} onChange={(e) => setOutlier(e.target.value)} className="w-24" /></Field>
      </div>
    </Dialog>
  );
}
