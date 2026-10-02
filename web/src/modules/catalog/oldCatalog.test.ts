import { describe, expect, it } from 'vitest';
import { cleanBarcode, convertOldGroup, convertOldProduct, rublesToKopecks } from './oldCatalog';

describe('перенос старого каталога', () => {
  it('товар: рубли → копейки, «кг» → kg, наличие, дата, штрихкоды', () => {
    expect(
      convertOldProduct({
        id: '3f4933ec-86a7-4c3e-8300-6f0d30b5e63e', name: ' Сникерс Весовой 1кг ', code: '14482',
        barcodes: ['2800000167080', '1 2040760231397', '2800000167080'], group_id: '3aa1a443-465d-4897-94eb-02966d46f1c3',
        retail_price: 1210, is_weighted: true, unit: 'кг', photos: [], arrival_at: '2026-08-24', stock_state: 'low',
      }),
    ).toEqual({
      id: '3f4933ec-86a7-4c3e-8300-6f0d30b5e63e', cash_code: '14482', name: 'Сникерс Весовой 1кг',
      group_id: '3aa1a443-465d-4897-94eb-02966d46f1c3', unit: 'kg', is_weighted: true, retail_price: 121000,
      in_stock: true, arrival_on: '2026-08-24', barcodes: ['2800000167080', '2040760231397'],
    });
  });

  it('наличие: out → нет, нет отметки → неизвестно', () => {
    expect(convertOldProduct({ name: 'x', stock_state: 'out' })?.in_stock).toBe(false);
    expect(convertOldProduct({ name: 'x' })?.in_stock).toBeNull();
  });

  it('дробные рубли без ошибок округления', () => {
    expect(rublesToKopecks(89.9)).toBe(8990);
    expect(rublesToKopecks(0.29)).toBe(29);
    expect(rublesToKopecks(-1)).toBeNull();
    expect(rublesToKopecks('89')).toBeNull();
  });

  it('штрихкод с количеством впереди', () => {
    expect(cleanBarcode('8 4607194352029')).toBe('4607194352029');
    expect(cleanBarcode(' 4600000000011 ')).toBe('4600000000011');
  });

  it('битые строки и чужие id отбрасываются', () => {
    expect(convertOldProduct({ code: '1' })).toBeNull();
    expect(convertOldProduct({ id: 'не-uuid', name: 'x' })?.id).toBeNull();
    expect(convertOldGroup({ id: 'x', name: ' Напитки ' })).toEqual({ id: null, name: 'Напитки' });
  });
});
