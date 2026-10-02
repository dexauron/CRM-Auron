// Open Food Facts (КАТ-7) — открытая база товаров с фото по штрихкоду (данные ODbL, фото CC BY-SA).
// Отсюда старый каталог брал большую часть фото; сюда же можно обратиться за фото товара без снимка.
// Только чтение открытых данных: ничего о магазине и покупателях туда не отправляется, кроме штрихкода.

/** Сайты фото семейства Open Food Facts — только с них разрешено скачивание (CSP и проверка ниже). */
const IMAGE_HOST = /^images\.open(food|products|beauty|petfood)facts\.org$/;
const API = 'https://world.openfoodfacts.org/api/v2/product';
const MAX_IMAGE = 8 * 1024 * 1024;

export function isOffImage(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && IMAGE_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

/** Адрес главного фото товара по штрихкоду или null, если товара или фото в базе нет. */
export async function findOffPhoto(barcode: string, signal?: AbortSignal): Promise<string | null> {
  if (!/^\d{8,14}$/.test(barcode)) return null;
  const init: RequestInit = { headers: { Accept: 'application/json' } };
  if (signal) init.signal = signal;
  const response = await fetch(`${API}/${barcode}.json?fields=image_front_url,image_url`, init);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Open Food Facts недоступен');
  const data: unknown = await response.json();
  const product = typeof data === 'object' && data !== null ? (data as { product?: Record<string, unknown> }).product : undefined;
  const url = product?.image_front_url ?? product?.image_url;
  return typeof url === 'string' && isOffImage(url) ? url : null;
}

/** Скачивает фото с сайта Open Food Facts (другие адреса не принимаются). */
export async function downloadOffImage(url: string, signal?: AbortSignal): Promise<Blob> {
  if (!isOffImage(url)) throw new Error('not-off');
  const init: RequestInit = { redirect: 'error' };
  if (signal) init.signal = signal;
  const response = await fetch(url, init);
  if (!response.ok) throw new Error('Фото не скачалось');
  const blob = await response.blob();
  if (!blob.type.startsWith('image/') || blob.size > MAX_IMAGE) throw new Error('not-image');
  return blob;
}
