// Перенос фото старого каталога (КАТ-7). Большая часть фото там — из Open Food Facts: их телефон скачивает
// сам, перерисовывает (без EXIF, с миниатюрой) и загружает как обычное фото с пометкой источника.
// Фото со старого сервера магазина сюда не входят: его адрес не должен попасть в код и CSP.
import type { CatalogProduct, ProductPhoto } from '../../api/catalog';
import { downloadOffImage, isOffImage } from '../../api/openFoodFacts';
import { uploadProductPhoto } from '../../api/photos';
import { preparePhoto } from '../../shared/image';
import type { OldPhoto } from './oldCatalog';

export interface TransferPlan {
  items: { productId: string; url: string }[];
  /** У товара уже есть фото — пропускаем: повторный перенос не задвоит. */
  alreadyHas: number;
  /** Фото не из Open Food Facts (старый сервер) — переносятся отдельно. */
  otherHost: number;
  /** Товара нет в новом каталоге. */
  noProduct: number;
}

/** `withPhotos` — товары, у которых фото уже есть по данным сервера: план не зависит от копии каталога на устройстве. */
export function planPhotoTransfer(
  photos: readonly OldPhoto[],
  products: readonly CatalogProduct[],
  withPhotos: ReadonlySet<string>,
): TransferPlan {
  const byCode = new Map<string, CatalogProduct>();
  const byId = new Map<string, CatalogProduct>();
  for (const p of products) {
    if (p.cashCode) byCode.set(p.cashCode, p);
    byId.set(p.id, p);
  }
  const plan: TransferPlan = { items: [], alreadyHas: 0, otherHost: 0, noProduct: 0 };
  const planned = new Set<string>();
  for (const photo of photos) {
    if (!isOffImage(photo.url)) {
      plan.otherHost++;
      continue;
    }
    const product = (photo.code ? byCode.get(photo.code) : undefined) ?? (photo.id ? byId.get(photo.id) : undefined);
    if (!product) plan.noProduct++;
    else if (withPhotos.has(product.id) || planned.has(product.id)) plan.alreadyHas++;
    else {
      planned.add(product.id);
      plan.items.push({ productId: product.id, url: photo.url });
    }
  }
  return plan;
}

/** Переносит фото по плану, по 4 одновременно. Ошибка одного фото не останавливает остальные. */
export async function runPhotoTransfer(
  orgId: string,
  plan: TransferPlan,
  onProgress: (done: number, failed: number) => void,
): Promise<{ done: number; failed: number; added: Map<string, ProductPhoto> }> {
  let next = 0;
  let done = 0;
  let failed = 0;
  const added = new Map<string, ProductPhoto>();
  const worker = async () => {
    for (let i = next++; i < plan.items.length; i = next++) {
      const item = plan.items[i];
      if (!item) continue;
      try {
        const { full, thumb } = await preparePhoto(await downloadOffImage(item.url));
        added.set(item.productId, await uploadProductPhoto(orgId, item.productId, full, thumb, 0, 'openfoodfacts'));
        done++;
      } catch {
        failed++;
      }
      onProgress(done, failed);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return { done, failed, added };
}
