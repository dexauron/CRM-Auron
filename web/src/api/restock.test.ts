import { describe, expect, it } from 'vitest';
import { groupBySupplier, parseRestock, RestockError, restockText } from './restock';

const row = (id: string, name: string, supplier: string | null, ordered: string | null = null) => ({
  id, product_id: `p-${id}`, name, cash_code: id, unit: 'pcs', created_at: '2026-10-02T09:00:00Z', ordered_at: ordered,
  who: null, supplier_id: supplier ? `s-${supplier}` : null, supplier_name: supplier,
});

describe('ПСТ-3: «Закончилось на полке»', () => {
  it('по поставщикам, без поставщика — в конце, незаказанное — сверху', () => {
    const groups = groupBySupplier(parseRestock([
      row('1', 'Хлеб', 'Пекарь', '2026-10-01T00:00:00Z'), row('2', 'Батон', 'Пекарь'), row('3', 'Соль', null), row('4', 'Кефир', 'Молочный'),
    ]));
    expect(groups.map((g) => [g.name, g.items.map((i) => i.name)])).toEqual([
      ['Молочный', ['Кефир']], ['Пекарь', ['Батон', 'Хлеб']], [null, ['Соль']],
    ]);
  });
  it('текст для мессенджера — только незаказанное', () => {
    const text = restockText(groupBySupplier(parseRestock([row('1', 'Хлеб', 'Пекарь', '2026-10-01T00:00:00Z'), row('2', 'Батон', 'Пекарь'), row('3', 'Соль', null)])),
      'Закончилось на полке:', 'Поставщик не указан');
    expect(text).toBe('Закончилось на полке:\n\nПекарь:\n— Батон (код 2)\n\nПоставщик не указан:\n— Соль (код 3)');
  });
  it.each([null, {}, [{ ...row('1', 'Хлеб', null), id: 5 }], [{ ...row('1', 'Хлеб', null), supplier_name: 7 }]])('отклоняет неверный ответ %o', (bad) => {
    expect(() => parseRestock(bad)).toThrow(RestockError);
  });
});
