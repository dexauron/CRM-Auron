// Фото товаров (КАТ-7): файлы в Storage (корзина product-photos), список — в таблице product_photos.
// Загружают и удаляют владелец и управляющий со вторым фактором; права проверяет сервер (RLS).
import type { ProductPhoto } from './catalog';
import { api } from './client';

const BUCKET = 'product-photos';
const base = import.meta.env.VITE_SUPABASE_URL ?? '';

/** Адрес фото (открытая корзина); thumb — уменьшенная копия для списков. */
export function photoUrl(path: string, thumb = false): string {
  return `${base}/storage/v1/object/public/${BUCKET}/${thumb ? path.replace(/\.jpg$/, '-t.jpg') : path}`;
}

function randomName(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('');
}

/** Загружает фото и уменьшенную копию, затем добавляет запись. */
export async function uploadProductPhoto(
  orgId: string,
  productId: string,
  full: Blob,
  thumb: Blob,
  sort: number,
  source: ProductPhoto['source'] = null,
): Promise<ProductPhoto> {
  const path = `${orgId}/${productId}/${randomName()}.jpg`;
  const thumbPath = path.replace(/\.jpg$/, '-t.jpg');
  const storage = api().storage.from(BUCKET);
  const options = { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false };
  const [a, b] = await Promise.all([storage.upload(path, full, options), storage.upload(thumbPath, thumb, options)]);
  if (a.error || b.error) {
    await storage.remove([path, thumbPath]);
    throw new Error('Не удалось загрузить фото');
  }
  const { error } = await api().from('product_photos').insert({ product_id: productId, org_id: orgId, path, sort, source });
  if (error) {
    await storage.remove([path, thumbPath]);
    throw new Error('Не удалось сохранить фото');
  }
  return { path, source };
}

/** Удаляет запись и оба файла. */
export async function deleteProductPhoto(path: string): Promise<void> {
  const { error } = await api().from('product_photos').delete().eq('path', path);
  if (error) throw new Error('Не удалось удалить фото');
  // Файлы без записи никому не видны в каталоге; если удаление файла не прошло, запись уже убрана.
  await api().storage.from(BUCKET).remove([path, path.replace(/\.jpg$/, '-t.jpg')]);
}

/** Товары магазина, у которых уже есть фото (по данным сервера, а не копии на устройстве). */
export async function loadProductsWithPhotos(orgId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await api()
      .from('product_photos')
      .select('product_id')
      .eq('org_id', orgId)
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error('Не удалось проверить фото');
    for (const row of data as { product_id: unknown }[]) if (typeof row.product_id === 'string') ids.add(row.product_id);
    if (data.length < 1000) return ids;
  }
}
