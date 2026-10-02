// КАТ-6: закрытые отчёты только по запросу, без localStorage / IndexedDB.
import { api } from './client';

export const issueKinds = ['missing_price', 'below_cost', 'no_markup', 'low_markup', 'duplicate_barcodes', 'price_rise', 'bestsellers', 'competitor_cheaper'] as const;
export type IssueKind = (typeof issueKinds)[number];
/** Проверки цен и кодов; остальное — отчёты по истории цен и продажам. */
export const checkKinds: readonly IssueKind[] = ['missing_price', 'below_cost', 'no_markup', 'low_markup', 'duplicate_barcodes'];
export const reportKinds: readonly IssueKind[] = ['price_rise', 'bestsellers', 'competitor_cheaper'];
export interface CatalogIssue {
  id: string;
  name: string;
  cashCode: string | null;
  unit: 'pcs' | 'kg';
  retailPrice: bigint | null;
  purchasePrice: bigint | null;
  barcode: string | null;
  barcodeCount: number | null;
  /** «Подорожало»: какая цена, сколько было и стало, когда менялась последний раз. */
  priceKind: 'retail' | 'purchase' | null;
  oldPrice: bigint | null;
  newPrice: bigint | null;
  changedAt: string | null;
  /** «Ходовые»: продано за период и выручка в копейках. */
  qty: number | null;
  amount: bigint | null;
  /** «Дешевле у конкурентов»: магазин, его свежая цена и день записи. */
  rival: string | null;
  rivalPrice: bigint | null;
  observedOn: string | null;
}
export interface CatalogIssues {
  counts: Record<IssueKind, number>;
  total: number;
  items: CatalogIssue[];
  /** Период отчёта продаж, по которому считаются «Ходовые»; null — продажи не загружены. */
  salesPeriod: { from: string; to: string } | null;
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
function price(value: unknown, signed = false): bigint | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !(signed ? /^-?\d+$/ : /^\d+$/).test(value)) return invalid();
  if (value.replace('-', '').length > 19) return invalid();
  const amount = BigInt(value);
  return amount <= 9223372036854775807n && amount >= -9223372036854775808n ? amount : invalid();
}
/** Поля отчётов есть не у всех видов: отсутствие — то же, что null. */
const optional = (value: unknown) => (value === undefined ? null : value);
const day = /^\d{4}-\d{2}-\d{2}$/;

function quantity(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^-?\d{1,12}(\.\d{1,3})?$/.test(value)) return invalid();
  return Number(value);
}

function salesPeriod(value: unknown): CatalogIssues['salesPeriod'] {
  if (value === null || value === undefined) return null;
  if (!record(value) || typeof value.from !== 'string' || typeof value.to !== 'string'
    || !day.test(value.from) || !day.test(value.to) || value.from > value.to) return invalid();
  return { from: value.from, to: value.to };
}

export function parseCatalogIssues(value: unknown): CatalogIssues {
  if (!record(value) || !record(value.counts) || !count(value.total) || !Array.isArray(value.items)) return invalid();
  const counts: Record<IssueKind, number> = {
    missing_price: 0, below_cost: 0, no_markup: 0, low_markup: 0, duplicate_barcodes: 0, price_rise: 0, bestsellers: 0,
    competitor_cheaper: 0,
  };
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
    const priceKind = optional(row.price_kind);
    const changedAt = optional(row.changed_at);
    const rival = optional(row.rival);
    const observedOn = optional(row.observed_on);
    if (!(priceKind === null || priceKind === 'retail' || priceKind === 'purchase')
      || !(changedAt === null || (typeof changedAt === 'string' && !Number.isNaN(Date.parse(changedAt))))
      || !nullableText(rival) || !(observedOn === null || (typeof observedOn === 'string' && day.test(observedOn)))) return invalid();
    return {
      id: row.id, name: row.name, cashCode: row.cash_code, unit: row.unit,
      retailPrice: price(row.retail_price), purchasePrice: price(row.purchase_price),
      barcode: row.barcode, barcodeCount: row.barcode_count,
      priceKind, oldPrice: price(optional(row.old_price)), newPrice: price(optional(row.new_price)), changedAt,
      qty: quantity(optional(row.qty)), amount: price(optional(row.amount), true),
      rival, rivalPrice: price(optional(row.rival_price)), observedOn,
    };
  });
  if (items.length > value.total) return invalid();
  return { counts, total: value.total, items, salesPeriod: salesPeriod(value.sales_period) };
}

export async function loadCatalogIssues(orgId: string, kind: IssueKind, offset: number, signal: AbortSignal): Promise<CatalogIssues> {
  const { data, error } = await api().rpc('catalog_issues', {
    p_org: orgId, p_kind: kind, p_offset: offset, p_limit: 50,
  }).abortSignal(signal);
  if (error) throw new CatalogToolsError(error.code === '42501' ? 'forbidden' : 'unavailable');
  return parseCatalogIssues(data);
}
