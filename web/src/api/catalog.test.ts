import { describe, expect, it } from 'vitest';
import { parseProduct } from './catalog';

describe('parseProduct', () => {
  it('строка из базы → товар каталога', () => {
    expect(
      parseProduct({
        id: 'p1', name: 'Молоко', group_id: 'g1', cash_code: '100500', article: null, unit: 'pcs', is_weighted: false,
        retail_price: 8900, in_stock: true, arrival_on: '2026-10-01', product_barcodes: [{ barcode: '4600000000011' }],
      }),
    ).toEqual({
      id: 'p1', name: 'Молоко', groupId: 'g1', cashCode: '100500', article: null, barcodes: ['4600000000011'],
      isWeighted: false, retailPrice: 8900, inStock: true, arrivalOn: '2026-10-01', unit: 'pcs',
    });
  });

  it('КАТ-4: лишние поля из ответа не попадают в товар', () => {
    const p = parseProduct({ id: 'p', name: 'X', purchase_price: 1, stock: 5 });
    expect(p && Object.keys(p)).not.toContain('purchase_price');
    expect(p && Object.keys(p)).not.toContain('stock');
  });

  it('битая строка — null; дробная цена не принимается', () => {
    expect(parseProduct({ name: 'без id' })).toBeNull();
    expect(parseProduct({ id: 'p', name: 'X', retail_price: 89.5 })?.retailPrice).toBeNull();
  });
});
