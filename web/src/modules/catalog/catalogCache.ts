// Каталог на устройстве (КАТ-8): показывается сразу при входе и без сети; скачивается заново,
// только когда версия на сервере изменилась (public.catalog_version).
import type { CatalogProduct, Store } from '../../api/catalog';
import { readOffline, writeOffline } from '../../shared/offline';
import type { CatalogGroup } from './search';

/** Меняется, когда меняется формат сохранённых данных: старые записи тогда не читаются. */
const SCHEMA = 3;

export interface CachedCatalog {
  schema: typeof SCHEMA;
  version: string;
  savedAt: string;
  store: Store;
  groups: CatalogGroup[];
  products: CatalogProduct[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Проверка записи из хранилища: битая или старого формата — как будто её нет. */
export function parseCachedCatalog(value: unknown): CachedCatalog | null {
  if (!isRecord(value) || value.schema !== SCHEMA) return null;
  const { version, savedAt, store, groups, products } = value;
  if (typeof version !== 'string' || typeof savedAt !== 'string') return null;
  if (!isRecord(store) || typeof store.id !== 'string' || typeof store.name !== 'string') return null;
  if (!Array.isArray(groups) || !Array.isArray(products)) return null;
  const valid = (p: unknown) =>
    isRecord(p) && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.barcodes) && Array.isArray(p.photos);
  if (!products.every(valid)) {
    return null;
  }
  return value as unknown as CachedCatalog;
}

const key = (slug: string) => `catalog:${slug}`;

export async function readCachedCatalog(slug: string): Promise<CachedCatalog | null> {
  return parseCachedCatalog(await readOffline(key(slug)));
}

export async function saveCatalog(slug: string, entry: Omit<CachedCatalog, 'schema'>): Promise<void> {
  await writeOffline(key(slug), { schema: SCHEMA, ...entry });
}

/** Магазин закрыл каталог — копию на устройстве тоже убираем. */
export async function clearCatalog(slug: string): Promise<void> {
  await writeOffline(key(slug), null);
}
