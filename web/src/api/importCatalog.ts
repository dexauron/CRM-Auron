// Импорт каталога (КАТ-5): порциями через серверную функцию import_catalog — она проверяет права,
// не создаёт дублей по коду кассы и не стирает заполненное пустым.
import { api } from './client';

export interface ImportGroup {
  id: string | null;
  name: string;
}

export interface ImportProduct {
  id: string | null;
  cash_code: string | null;
  name: string;
  group_id: string | null;
  unit: 'pcs' | 'kg';
  is_weighted: boolean;
  retail_price: number | null;
  in_stock: boolean | null;
  arrival_on: string | null;
  barcodes: string[];
}

export interface ImportTotals {
  groups: number;
  inserted: number;
  updated: number;
  barcodes: number;
  skipped: number;
}

const BATCH = 1000;
const num = (value: unknown) => (typeof value === 'number' ? value : 0);

export async function importCatalog(
  orgId: string,
  groups: ImportGroup[],
  products: ImportProduct[],
  onProgress: (done: number, total: number) => void,
): Promise<ImportTotals> {
  const totals: ImportTotals = { groups: 0, inserted: 0, updated: 0, barcodes: 0, skipped: 0 };
  const add = (data: unknown) => {
    if (typeof data !== 'object' || data === null) return;
    const d = data as Record<string, unknown>;
    totals.groups += num(d.groups);
    totals.inserted += num(d.inserted);
    totals.updated += num(d.updated);
    totals.barcodes += num(d.barcodes);
    totals.skipped += num(d.skipped);
  };
  for (let i = 0; i < Math.max(groups.length, 1); i += BATCH) {
    const res = await api().rpc('import_catalog', { p_org: orgId, p_groups: groups.slice(i, i + BATCH), p_products: [] });
    if (res.error) throw new Error('Не удалось загрузить группы');
    add(res.data);
  }
  onProgress(0, products.length);
  for (let i = 0; i < products.length; i += BATCH) {
    const res = await api().rpc('import_catalog', { p_org: orgId, p_groups: [], p_products: products.slice(i, i + BATCH) });
    if (res.error) throw new Error('Не удалось загрузить товары');
    add(res.data);
    onProgress(Math.min(i + BATCH, products.length), products.length);
  }
  return totals;
}

/** Закупка и остаток товара (копейки, количество). Пишет только владелец со вторым фактором. */
export interface ImportInternal {
  product_id: string;
  purchase_price: number | null;
  stock: number | null;
}

export interface InternalsTotals {
  matched: number;
  changed: number;
  skipped: number;
}

export async function importInternals(
  orgId: string,
  rows: ImportInternal[],
  onProgress: (done: number, total: number) => void,
): Promise<InternalsTotals> {
  const totals: InternalsTotals = { matched: 0, changed: 0, skipped: 0 };
  for (let i = 0; i < rows.length; i += BATCH) {
    const res = await api().rpc('import_internals', { p_org: orgId, p_rows: rows.slice(i, i + BATCH) });
    if (res.error) throw new Error(res.error.code === '42501' ? 'forbidden' : 'Не удалось загрузить закупку и остатки');
    const d = (typeof res.data === 'object' && res.data !== null ? res.data : {}) as Record<string, unknown>;
    totals.matched += num(d.matched);
    totals.changed += num(d.changed);
    totals.skipped += num(d.skipped);
    onProgress(Math.min(i + BATCH, rows.length), rows.length);
  }
  return totals;
}

/** Продажи товара за период: количество и выручка в копейках (null — в отчёте нет суммы). */
export interface ImportSale {
  product_id: string;
  qty: number;
  amount: number | null;
}

/** Отчёт продаж порциями: первая создаёт отчёт на сервере, последняя его завершает — прерванный не попадёт в «Ходовые». */
export async function importSales(
  orgId: string,
  period: { from: string; to: string },
  rows: ImportSale[],
  onProgress: (done: number, total: number) => void,
): Promise<number> {
  let report: number | null = null;
  let matched = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const res = await api().rpc('import_sales', {
      p_org: orgId, p_report: report, p_from: period.from, p_to: period.to,
      p_rows: rows.slice(i, i + BATCH), p_done: i + BATCH >= rows.length,
    });
    if (res.error) throw new Error(res.error.code === '42501' ? 'forbidden' : 'Не удалось загрузить продажи');
    const d = (typeof res.data === 'object' && res.data !== null ? res.data : {}) as Record<string, unknown>;
    if (typeof d.report !== 'number') throw new Error('Не удалось загрузить продажи');
    report = d.report;
    matched += num(d.matched);
    onProgress(Math.min(i + BATCH, rows.length), rows.length);
  }
  return matched;
}
