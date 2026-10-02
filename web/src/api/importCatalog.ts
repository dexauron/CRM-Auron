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
