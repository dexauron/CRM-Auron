// КАТ-6: закрытые отчёты только по запросу, без localStorage / IndexedDB.
import { api } from './client';

export const issueKinds = ['missing_price', 'below_cost', 'no_markup', 'duplicate_barcodes'] as const;
export type IssueKind = (typeof issueKinds)[number];
export interface CatalogIssue {
  id: string;
  name: string;
  cashCode: string | null;
  unit: 'pcs' | 'kg';
  retailPrice: bigint | null;
  purchasePrice: bigint | null;
  barcode: string | null;
  barcodeCount: number | null;
}
export interface CatalogIssues {
  counts: Record<IssueKind, number>;
  total: number;
  items: CatalogIssue[];
}

export class CatalogToolsError extends Error {
  constructor(readonly reason: 'forbidden' | 'unavailable' | 'invalid') {
    super(reason);
    this.name = 'CatalogToolsError';
  }
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nullableText = (value: unknown): value is string | null => value === null || typeof value === 'string';
const invalid = (): never => { throw new CatalogToolsError('invalid'); };

/** Копейки не проходят через number: различаем даже соседние bigint за пределами его точности. */
function price(value: unknown): bigint | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return invalid();
  if (value.length > 19) return invalid();
  const amount = BigInt(value);
  return amount <= 9223372036854775807n ? amount : invalid();
}

export function parseCatalogIssues(value: unknown): CatalogIssues {
  if (!record(value) || !record(value.counts) || !count(value.total) || !Array.isArray(value.items)) return invalid();
  const counts: Record<IssueKind, number> = { missing_price: 0, below_cost: 0, no_markup: 0, duplicate_barcodes: 0 };
  for (const kind of issueKinds) {
    const n = value.counts[kind];
    if (!count(n)) return invalid();
    counts[kind] = n;
  }
  const items = (value.items as unknown[]).map((row): CatalogIssue => {
    if (!record(row) || typeof row.id !== 'string' || typeof row.name !== 'string'
      || !nullableText(row.cash_code) || (row.unit !== 'pcs' && row.unit !== 'kg') || !nullableText(row.barcode)
      || !(row.barcode_count === null || (count(row.barcode_count) && row.barcode_count >= 2))
      || ((row.barcode === null) !== (row.barcode_count === null))) return invalid();
    return {
      id: row.id, name: row.name, cashCode: row.cash_code, unit: row.unit,
      retailPrice: price(row.retail_price), purchasePrice: price(row.purchase_price),
      barcode: row.barcode, barcodeCount: row.barcode_count,
    };
  });
  if (items.length > value.total) return invalid();
  return { counts, total: value.total, items };
}

export async function loadCatalogIssues(orgId: string, kind: IssueKind, offset: number, signal: AbortSignal): Promise<CatalogIssues> {
  const { data, error } = await api().rpc('catalog_issues', {
    p_org: orgId, p_kind: kind, p_offset: offset, p_limit: 50,
  }).abortSignal(signal);
  if (error) throw new CatalogToolsError(error.code === '42501' ? 'forbidden' : 'unavailable');
  return parseCatalogIssues(data);
}
