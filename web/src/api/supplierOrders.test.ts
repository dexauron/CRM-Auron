import { describe, expect, it } from 'vitest';
import {
  canEditItems, nextStatuses, orderText, OrdersError, parseOrder, parseOrdersView, type OrderFull,
} from './supplierOrders';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'o1', supplier_id: 's1', supplier_name: 'ООО Молочный опт', status: 'created',
  expected_at: '2026-10-09', created_at: '2026-10-07T06:00:00Z', items: 2,
  amount: 152925, amount_actual: null, no_price: 0, overdue: false, ...over,
});
const view = (over: Record<string, unknown> = {}) => ({
  money: true, orders: [row()], days: [{ date: '2026-10-09', orders: 1, amount: 152925, overdue: false }],
  overdue: { orders: 0, amount: null }, ...over,
});
const item = (over: Record<string, unknown> = {}) => ({
  id: 'i1', product_id: 'p1', name: 'Молоко 3,2%', cash_code: '101', unit: 'pcs',
  qty: 6, price: 8000, sum: 48000, ...over,
});
const full = (over: Record<string, unknown> = {}) => ({
  money: true, id: 'o1', supplier_id: 's1', supplier_name: 'ООО Молочный опт', status: 'created',
  expected_at: '2026-10-09', created_at: '2026-10-07T06:00:00Z', confirmed_at: null, closed_at: null,
  note: null, who: 'Пётр Кладовщик', amount: 152925, amount_actual: null,
  items: [item(), item({ id: 'i2', product_id: 'p2', name: 'Сыр Российский', cash_code: '5940', unit: 'kg', qty: 1.5, price: 69950, sum: 104925 })],
  ...over,
});

const labels = {
  title: 'Заказ', expected: 'Ждём', unit: { pcs: 'шт', kg: 'кг' } as const, total: 'Примерно на сумму',
};

describe('ПСТ-2: заказы поставщикам', () => {
  it('читает список, календарь и просрочку', () => {
    const v = parseOrdersView(view({ overdue: { orders: 2, amount: 40000 } }));
    expect(v.money).toBe(true);
    expect(v.orders[0]).toMatchObject({ supplierName: 'ООО Молочный опт', amount: 152925, noPrice: 0 });
    expect(v.days[0]).toEqual({ date: '2026-10-09', orders: 1, amount: 152925, overdue: false });
    expect(v.overdue).toEqual({ orders: 2, amount: 40000 });
  });

  /* Сотруднику зала сервер денег не отдаёт вовсе — не нули, а именно «нет». Нули соврали бы,
     что заказ бесплатный, а так интерфейс знает, что суммы ему просто не положены. */
  it('роль без прав на деньги получает пустые суммы, а не нули', () => {
    const v = parseOrdersView(view({
      money: false, orders: [row({ amount: null, amount_actual: null })],
      days: [{ date: '2026-10-09', orders: 1, amount: null, overdue: false }],
    }));
    expect(v.money).toBe(false);
    expect(v.orders[0]?.amount).toBeNull();
    expect(v.days[0]?.amount).toBeNull();
  });

  it('читает заказ с составом, вес — дробью', () => {
    const o = parseOrder(full());
    expect(o.items.map((i) => [i.name, i.qty, i.unit, i.sum]))
      .toEqual([['Молоко 3,2%', 6, 'pcs', 48000], ['Сыр Российский', 1.5, 'kg', 104925]]);
    expect(o.who).toBe('Пётр Кладовщик');
  });

  it('заказ без состава — не ошибка: позиции могли быть убраны', () => {
    expect(parseOrder(full({ items: [] })).items).toEqual([]);
  });

  // Копейки всегда целые: дробная «сумма» означала бы, что где-то делили на 100 раньше времени.
  it.each([
    ['дробные копейки', full({ amount: 1529.25 })],
    ['дробные копейки в строке', full({ items: [item({ sum: 480.5 })] })],
    ['неизвестное состояние', full({ status: 'paid' })],
    ['неизвестная единица', full({ items: [item({ unit: 'litre' })] })],
    ['нулевое количество', full({ items: [item({ qty: 0 })] })],
    ['нет состава вовсе', full({ items: undefined })],
  ])('отклоняет ответ: %s', (_name, bad) => {
    expect(() => parseOrder(bad)).toThrow(OrdersError);
  });

  it.each([null, {}, view({ orders: {} }), view({ overdue: null }), view({ days: [{ date: '2026-10-09' }] })])(
    'отклоняет неверный список %o', (bad) => {
      expect(() => parseOrdersView(bad)).toThrow(OrdersError);
    });

  /* Путь документа: создан → подтверждён → принят. Назад и «сразу принят» — нельзя, иначе заказ
     перестаёт быть доказательством того, что происходило. */
  it('состояния идут только вперёд', () => {
    expect(nextStatuses('created')).toEqual(['confirmed', 'cancelled']);
    expect(nextStatuses('confirmed')).toEqual(['received', 'cancelled']);
    expect(nextStatuses('received')).toEqual([]);
    expect(nextStatuses('cancelled')).toEqual([]);
  });

  it('состав меняют, пока заказ не подтверждён', () => {
    expect(canEditItems('created')).toBe(true);
    expect(['confirmed', 'received', 'cancelled'].map((s) => canEditItems(s as 'confirmed'))).toEqual([false, false, false]);
  });

  it('текст для поставщика: количество с единицей, дата по-русски', () => {
    const text = orderText(parseOrder(full({ note: 'Привезти до обеда' })), labels);
    expect(text).toBe([
      'Заказ: ООО Молочный опт',
      'Ждём: 09.10.2026',
      '',
      '1. Молоко 3,2% (код 101) — 6 шт',
      '2. Сыр Российский (код 5940) — 1,5 кг',
      '',
      'Примерно на сумму: 1\u00a0529,25\u00a0₽',
      '',
      'Привезти до обеда',
    ].join('\n'));
  });

  it('без прав на деньги сумма в тексте не появляется', () => {
    const o: OrderFull = parseOrder(full({ money: false, amount: null, items: [item({ price: null, sum: null })] }));
    expect(orderText(o, labels)).not.toContain('сумму');
    expect(orderText(o, labels)).toContain('6 шт');
  });
});
