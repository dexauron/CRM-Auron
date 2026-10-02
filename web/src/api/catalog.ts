// Каталог магазина (КАТ-1, КАТ-4): открытая часть — название, коды, цена на полке, «есть / нет», дата поступления.
// Закрытые сведения (закупка, остаток) этот модуль не запрашивает: они в product_internals и гостю не отдаются.
import { api } from './client';
import type { CatalogGroup, CatalogItem } from '../modules/catalog/search';

export interface Store {
  id: string;
  name: string;
}

export interface CatalogProduct extends CatalogItem {
  retailPrice: number | null;
  inStock: boolean | null;
  arrivalOn: string | null;
  unit: 'pcs' | 'kg';
}

const PAGE = 1000;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const str = (value: unknown) => (typeof value === 'string' && value ? value : null);

export function parseProduct(row: unknown): CatalogProduct | null {
  if (!isRecord(row) || typeof row.id !== 'string' || typeof row.name !== 'string') return null;
  const barcodes = Array.isArray(row.product_barcodes)
    ? (row.product_barcodes as unknown[]).flatMap((b) => (isRecord(b) && typeof b.barcode === 'string' ? [b.barcode] : []))
    : [];
  return {
    id: row.id,
    name: row.name,
    groupId: str(row.group_id),
    cashCode: str(row.cash_code),
    article: str(row.article),
    barcodes,
    isWeighted: row.is_weighted === true,
    retailPrice: typeof row.retail_price === 'number' && Number.isSafeInteger(row.retail_price) ? row.retail_price : null,
    inStock: typeof row.in_stock === 'boolean' ? row.in_stock : null,
    arrivalOn: str(row.arrival_on),
    unit: row.unit === 'kg' ? 'kg' : 'pcs',
  };
}

/** Магазин по короткому имени: виден гостю, если каталог открыт. */
export async function loadStore(slug: string): Promise<Store | null> {
  const { data, error } = await api().from('organizations').select('id, name').eq('slug', slug).maybeSingle();
  if (error) throw new Error('Не удалось открыть магазин');
  return isRecord(data) && typeof data.id === 'string' && typeof data.name === 'string' ? { id: data.id, name: data.name } : null;
}

export async function loadCatalog(orgId: string): Promise<{ groups: CatalogGroup[]; products: CatalogProduct[] }> {
  const groupsRes = await api().from('product_groups').select('id, name').eq('org_id', orgId).order('name').limit(5000);
  if (groupsRes.error) throw new Error('Не удалось загрузить группы');
  const groups = (groupsRes.data as unknown[]).flatMap((g) =>
    isRecord(g) && typeof g.id === 'string' && typeof g.name === 'string' ? [{ id: g.id, name: g.name }] : [],
  );

  const head = await api().from('products').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('active', true);
  if (head.error) throw new Error('Не удалось загрузить каталог');
  const total = head.count ?? 0;
  const pages = Array.from({ length: Math.ceil(total / PAGE) }, (_, i) => i);
  const products: CatalogProduct[] = [];
  // По четыре страницы одновременно: быстро и без лишней нагрузки на сервер.
  for (let i = 0; i < pages.length; i += 4) {
    const batch = await Promise.all(
      pages.slice(i, i + 4).map(async (page) => {
        const res = await api()
          .from('products')
          .select('id, group_id, name, cash_code, article, unit, is_weighted, retail_price, in_stock, arrival_on, product_barcodes(barcode)')
          .eq('org_id', orgId)
          .eq('active', true)
          .order('id')
          .range(page * PAGE, page * PAGE + PAGE - 1);
        if (res.error) throw new Error('Не удалось загрузить каталог');
        return res.data as unknown[];
      }),
    );
    for (const rows of batch) for (const row of rows) {
      const p = parseProduct(row);
      if (p) products.push(p);
    }
  }
  return { groups, products };
}
