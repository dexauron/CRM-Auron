// Фото товаров (КАТ-7): файлы в Storage (корзина product-photos), список — в таблице product_photos.
// Загружают и удаляют владелец и управляющий со вторым фактором; права проверяет сервер (RLS).
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

/** Загружает фото и уменьшенную копию, затем добавляет запись. Возвращает путь. */
export async function uploadProductPhoto(orgId: string, productId: string, full: Blob, thumb: Blob, sort: number): Promise<string> {
  const path = `${orgId}/${productId}/${randomName()}.jpg`;
  const thumbPath = path.replace(/\.jpg$/, '-t.jpg');
  const storage = api().storage.from(BUCKET);
  const options = { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false };
  const [a, b] = await Promise.all([storage.upload(path, full, options), storage.upload(thumbPath, thumb, options)]);
  if (a.error || b.error) {
    await storage.remove([path, thumbPath]);
    throw new Error('Не удалось загрузить фото');
  }
  const { error } = await api().from('product_photos').insert({ product_id: productId, org_id: orgId, path, sort });
  if (error) {
    await storage.remove([path, thumbPath]);
    throw new Error('Не удалось сохранить фото');
  }
  return path;
}

/** Удаляет запись и оба файла. */
export async function deleteProductPhoto(path: string): Promise<void> {
  const { error } = await api().from('product_photos').delete().eq('path', path);
  if (error) throw new Error('Не удалось удалить фото');
  // Файлы без записи никому не видны в каталоге; если удаление файла не прошло, запись уже убрана.
  await api().storage.from(BUCKET).remove([path, path.replace(/\.jpg$/, '-t.jpg')]);
}
