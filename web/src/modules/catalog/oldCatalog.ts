// Перенос товаров из старого каталога WayMarket (этап 1: «все товары перенесены, число совпадает»).
// Источник — открытые данные старого каталога на GitHub (названия, коды, цены на полке, наличие; закупок там нет).
import type { ImportGroup, ImportProduct } from '../../api/importCatalog';

export const OLD_CATALOG_DATA =
  'https://raw.githubusercontent.com/dexauron/auron/claude/store-product-catalog-60wer4/catalog/data';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STOCK: Record<string, boolean> = { in: true, low: true, out: false };

/** «1 2040760231397» (количество впереди) → «2040760231397». */
export function cleanBarcode(raw: string): string {
  const s = raw.trim();
  return /^\d+ (\S+)$/.exec(s)?.[1] ?? s;
}

/** Рубли из старого каталога → копейки, без ошибок округления дробей. */
export function rublesToKopecks(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export function convertOldProduct(row: unknown): ImportProduct | null {
  if (!isRecord(row) || typeof row.name !== 'string' || !row.name.trim()) return null;
  const barcodes = Array.isArray(row.barcodes) ? (row.barcodes as unknown[]).filter((b): b is string => typeof b === 'string').map(cleanBarcode) : [];
  return {
    id: typeof row.id === 'string' && UUID.test(row.id) ? row.id : null,
    cash_code: typeof row.code === 'string' && row.code.trim() ? row.code.trim() : null,
    name: row.name.trim(),
    group_id: typeof row.group_id === 'string' && UUID.test(row.group_id) ? row.group_id : null,
    unit: row.unit === 'кг' ? 'kg' : 'pcs',
    is_weighted: row.is_weighted === true,
    retail_price: rublesToKopecks(row.retail_price),
    in_stock: typeof row.stock_state === 'string' ? (STOCK[row.stock_state] ?? null) : null,
    arrival_on: typeof row.arrival_at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(row.arrival_at) ? row.arrival_at.slice(0, 10) : null,
    barcodes: [...new Set(barcodes)],
  };
}

export function convertOldGroup(row: unknown): ImportGroup | null {
  if (!isRecord(row) || typeof row.name !== 'string' || !row.name.trim()) return null;
  return { id: typeof row.id === 'string' && UUID.test(row.id) ? row.id : null, name: row.name.trim() };
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`${OLD_CATALOG_DATA}/${path}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Не удалось скачать ${path}`);
  return response.json();
}

/** Скачивает старый каталог: группы и товары (частями, как он хранился). */
export async function fetchOldCatalog(): Promise<{ groups: ImportGroup[]; products: ImportProduct[] }> {
  const index = await getJson('index.json');
  const parts = isRecord(index) && typeof index.n === 'number' ? index.n : 0;
  if (parts < 1 || parts > 100) throw new Error('Непонятный формат старого каталога');
  const [groupsRaw, ...partsRaw] = await Promise.all([
    getJson('groups.json'),
    ...Array.from({ length: parts }, (_, i) => getJson(`p/${String(i).padStart(2, '0')}.json`)),
  ]);
  const groups = (Array.isArray(groupsRaw) ? groupsRaw : []).map(convertOldGroup).filter((g): g is ImportGroup => g !== null);
  const products = partsRaw.flatMap((part) => (Array.isArray(part) ? part : [])).map(convertOldProduct).filter((p): p is ImportProduct => p !== null);
  return { groups, products };
}
