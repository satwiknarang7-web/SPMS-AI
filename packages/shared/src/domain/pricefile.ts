import type { Cents } from '../money';

/**
 * Supplier price file validation (HQ-PF-01..03).
 * Release 1 supports a CSV layout with a header row:
 *   barcode,supplier_code,description,cost,retail
 * `cost` and `retail` are dollars (GST-inclusive retail). Further formats are an open item.
 */
export const PRICE_FILE_COLUMNS = ['barcode', 'supplier_code', 'description', 'cost', 'retail'] as const;

export type PriceFileIssue = 'OK' | 'UNMATCHED' | 'ERROR' | 'OUTLIER';

export interface RawPriceRow {
  rowNo: number;
  barcode: string;
  supplierCode: string;
  description: string;
  cost: string;
  retail: string;
}

export interface CatalogueItem {
  id: string;
  barcode: string | null;
  supplierCode?: string | null;
  cost: Cents;
  retail: Cents;
}

export interface ValidatedPriceRow {
  rowNo: number;
  barcode: string;
  supplierCode: string;
  description: string;
  newCost: Cents | null;
  newRetail: Cents | null;
  productId: string | null;
  oldCost: Cents | null;
  oldRetail: Cents | null;
  changePct: number | null;
  issue: PriceFileIssue;
  message: string | null;
}

export function parsePriceCsv(text: string): { rows: RawPriceRow[]; headerError: string | null } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], headerError: 'File is empty.' };
  const header = splitCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const missing = PRICE_FILE_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) return { rows: [], headerError: `Missing column(s): ${missing.join(', ')}` };
  const idx = (c: string) => header.indexOf(c);
  const rows = lines.slice(1).map((line, i) => {
    const cells = splitCsvLine(line);
    const get = (c: string) => (cells[idx(c)] ?? '').trim();
    return { rowNo: i + 2, barcode: get('barcode'), supplierCode: get('supplier_code'), description: get('description'), cost: get('cost'), retail: get('retail') };
  });
  return { rows, headerError: null };
}

/** Minimal RFC-4180 style splitter supporting quoted cells. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const parseMoney = (s: string): Cents | null => {
  if (!/^\$?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number.parseFloat(s.replace('$', '')) * 100);
};

export function validatePriceRows(rows: readonly RawPriceRow[], catalogue: readonly CatalogueItem[], outlierPct = 20): ValidatedPriceRow[] {
  const byBarcode = new Map(catalogue.filter((c) => c.barcode).map((c) => [c.barcode!, c]));
  const bySupplierCode = new Map(catalogue.filter((c) => c.supplierCode).map((c) => [c.supplierCode!, c]));
  const seen = new Set<string>();

  return rows.map((r) => {
    const base = { rowNo: r.rowNo, barcode: r.barcode, supplierCode: r.supplierCode, description: r.description };
    const newCost = parseMoney(r.cost);
    const newRetail = parseMoney(r.retail);
    const err = (message: string): ValidatedPriceRow => ({
      ...base, newCost, newRetail, productId: null, oldCost: null, oldRetail: null, changePct: null, issue: 'ERROR', message,
    });

    if (!r.barcode && !r.supplierCode) return err('Row has neither a barcode nor a supplier code.');
    if (newCost == null) return err(`Invalid cost "${r.cost}".`);
    if (newRetail == null) return err(`Invalid retail "${r.retail}".`);
    if (newRetail < newCost) return err('Retail price is below cost.');
    const key = r.barcode || `sc:${r.supplierCode}`;
    if (seen.has(key)) return err('Duplicate item in file.');
    seen.add(key);

    const match = (r.barcode && byBarcode.get(r.barcode)) || (r.supplierCode && bySupplierCode.get(r.supplierCode)) || null;
    if (!match) {
      return { ...base, newCost, newRetail, productId: null, oldCost: null, oldRetail: null, changePct: null, issue: 'UNMATCHED', message: 'No matching product in the catalogue.' };
    }
    const changePct = match.cost > 0 ? ((newCost - match.cost) / match.cost) * 100 : null;
    const outlier = changePct != null && Math.abs(changePct) > outlierPct;
    return {
      ...base,
      newCost,
      newRetail,
      productId: match.id,
      oldCost: match.cost,
      oldRetail: match.retail,
      changePct,
      issue: outlier ? 'OUTLIER' : 'OK',
      message: outlier ? `Cost moved ${changePct!.toFixed(1)}% (threshold ±${outlierPct}%).` : null,
    };
  });
}
