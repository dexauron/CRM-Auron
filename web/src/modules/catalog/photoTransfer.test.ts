import { describe, expect, it } from 'vitest';
import type { CatalogProduct } from '../../api/catalog';
import { planPhotoTransfer } from './photoTransfer';

const product = (id: string, cashCode: string | null, photos: CatalogProduct['photos'] = []): CatalogProduct => ({
  id, name: id, groupId: null, cashCode, article: null, barcodes: [], isWeighted: false,
  retailPrice: null, inStock: null, arrivalOn: null, unit: 'pcs', photos,
});
const OFF = 'https://images.openfoodfacts.org/images/products/1/front.jpg';

describe('КАТ-7: план переноса фото старого каталога', () => {
  it('сопоставляет по коду кассы, затем по id; одно фото на товар', () => {
    const plan = planPhotoTransfer(
      [
        { id: 'old-1', code: '100', url: OFF },
        { id: 'p2', code: null, url: OFF },
        { id: 'p2', code: null, url: OFF.replace('1/', '2/') },
      ],
      [product('p1', '100'), product('p2', null)],
      new Set(),
    );
    expect(plan.items).toEqual([
      { productId: 'p1', url: OFF },
      { productId: 'p2', url: OFF },
    ]);
    expect(plan.alreadyHas).toBe(1);
  });

  it('фото уже есть на сервере, не Open Food Facts, нет товара — пропуск с подсчётом', () => {
    const plan = planPhotoTransfer(
      [
        { id: null, code: '1', url: OFF },
        { id: null, code: '2', url: 'https://storage.example.io/storage/v1/object/public/product-photos/a.jpg' },
        { id: null, code: '404', url: OFF },
      ],
      [product('p1', '1'), product('p2', '2')],
      new Set(['p1']),
    );
    expect(plan).toEqual({ items: [], alreadyHas: 1, otherHost: 1, noProduct: 1 });
  });
});
