import { describe, expect, it } from 'vitest';
import { parseCachedCatalog } from './catalogCache';

const good = {
  schema: 3,
  version: 'a:b:c',
  savedAt: '2026-10-02T10:00:00Z',
  store: { id: 's1', name: 'Way Market' },
  groups: [{ id: 'g1', name: 'Молоко' }],
  products: [{ id: 'p1', name: 'Молоко', barcodes: ['4600000000015'], photos: [] }],
};

describe('КАТ-8: каталог на устройстве', () => {
  it('целая запись читается', () => {
    expect(parseCachedCatalog(good)?.products).toHaveLength(1);
  });

  it('битая или старого формата — как будто её нет', () => {
    expect(parseCachedCatalog(undefined)).toBeNull();
    expect(parseCachedCatalog({ ...good, schema: 2 })).toBeNull();
    expect(parseCachedCatalog({ ...good, products: [{ id: 'p1', name: 'x', barcodes: [] }] })).toBeNull();
    expect(parseCachedCatalog({ ...good, version: 1 })).toBeNull();
    expect(parseCachedCatalog({ ...good, store: null })).toBeNull();
    expect(parseCachedCatalog({ ...good, products: [{ id: 'p1' }] })).toBeNull();
    expect(parseCachedCatalog({ ...good, groups: 'нет' })).toBeNull();
  });
});
