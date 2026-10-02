// Сопоставление и план загрузки 1С; случаи — из тестов старого каталога, данные вымышленные.
import { describe, expect, it } from 'vitest';
import type { CatalogProduct } from '../../../api/catalog';
import { parseBarcodesReport, parsePriceReport, parseRetailList, parseSalesReport, parseStockReport } from './parse';
import { buildImportPlan, pickPurchase } from './plan';

const product = (id: string, name: string, extra: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id, name, groupId: null, cashCode: null, article: null, barcodes: [], isWeighted: false,
  retailPrice: null, inStock: null, arrivalOn: null, unit: 'pcs', photos: [], ...extra,
});
const HEAD = ['Номенклатура', 'Код товара', 'Контрагент', 'Ед.', 'Цена', 'Период', 'Группа'];

describe('КАТ-5: план загрузки 1С', () => {
  it('закупка — за штуку или кг, а не за упаковку; самая свежая', () => {
    expect(pickPurchase([
      { supplier: 'Опт', price: 1920, unit: 'упак (48)', date: '2026-08-05' },
      { supplier: 'Своя', price: 43.33, unit: 'шт', date: '2026-08-01' },
      { supplier: 'Другой', price: 45, unit: 'шт', date: '2026-07-01' },
    ])).toBe(4333);
    expect(pickPurchase([{ supplier: 'Опт', price: 1920, unit: 'блок (12)', date: null }])).toBeNull();
  });

  it('пустой каталог: создаёт товары, группы, закупку; весовой по «кг»; дата поступления — самая свежая', () => {
    const plan = buildImportPlan([{ type: 'prices', items: parsePriceReport([
      HEAD,
      ['Snickers 50,5г', '1 463', 'Опт', 'упак (48)', '1 920,00', '05.08.2026', 'Шоколад'],
      ['Snickers 50,5г', '1 463', 'Своя', 'шт', '43,33', '01.08.2026', 'Шоколад'],
      ['Хлеб', '77', 'Пекарь', 'кг', '120', '02.08.2026', 'Выпечка'],
    ]) }], [], []);
    expect(plan.groups.map((g) => g.name)).toEqual(['Шоколад', 'Выпечка']);
    expect(plan.stats).toMatchObject({ created: 2, changed: 0 });
    const sn = plan.products.find((p) => p.cash_code === '1463');
    expect(sn).toMatchObject({ name: 'Snickers 50,5г', unit: 'pcs', arrival_on: '2026-08-05' });
    expect(plan.products.find((p) => p.cash_code === '77')).toMatchObject({ unit: 'kg', is_weighted: true });
    expect(plan.internals.find((r) => r.product_id === sn?.id)).toEqual({ product_id: sn?.id, purchase_price: 4333, stock: null });
  });

  it('существующий товар: найден по коду, не переименован; без изменений — не отправляется', () => {
    const catalog = [product('p1', 'Сникерс', { cashCode: '1463', retailPrice: 7500 }), product('p2', 'Вода', { cashCode: '5', retailPrice: 3500 })];
    const plan = buildImportPlan([{ type: 'stock', recs: parseStockReport([
      ['Номенклатура', 'Код товара', 'Количество', 'Розничная цена'],
      ['Snickers 50,5г', '1 463', '10', '79'],
      ['Вода', '5', '3', '35'],
    ]).recs }], catalog, []);
    expect(plan.products).toEqual([expect.objectContaining({ id: 'p1', name: 'Сникерс', cash_code: '1463', retail_price: 7900 })]);
    expect(plan.internals).toEqual([
      { product_id: 'p1', purchase_price: null, stock: 10 },
      { product_id: 'p2', purchase_price: null, stock: 3 },
    ]);
    expect(plan.stats).toMatchObject({ created: 0, changed: 1 });
  });

  it('штрихкоды: слова в другом порядке находят товар; разные фасовки не склеиваются; неизвестные — в счётчике', () => {
    const catalog = [
      product('a', 'Чабан Сметана 25% стакан 200г', { cashCode: '111' }),
      product('b', 'Huggies Трусики для Мальчиков 38шт', { cashCode: '222' }),
      product('c', 'Носки Синие 40р', { cashCode: '333' }),
      product('d', 'Синие Носки 40р', { cashCode: '334' }),
    ];
    const plan = buildImportPlan([{ type: 'barcodes', recs: parseBarcodesReport([
      ['Штрих код', 'Единица', 'Номенклатура'],
      ['4600000000015', 'шт', 'Сметана Чабан 25% стакан 200гр'],
      ['4600000000022', 'шт', 'Huggies Трусики для Мальчиков 44шт'],
      ['4600000000039', 'шт', 'Носки Синие 40р'],
    ]) }], catalog, []);
    const added = Object.fromEntries(plan.products.map((p) => [p.id, p.barcodes]));
    expect(added).toEqual({ a: ['4600000000015'], c: ['4600000000039'] });
    expect(plan.stats).toMatchObject({ created: 0, unmatched: 1, unmatchedNames: ['Huggies Трусики для Мальчиков 44шт'] });
  });

  it('прайс-лист: розница по названию и артикулу; не найденное не создаётся', () => {
    const catalog = [product('k', 'Кукла', { article: 'st-917', retailPrice: 100000 }), product('m', 'Молоко', { retailPrice: 8900 })];
    const plan = buildImportPlan([{ type: 'retail', recs: parseRetailList([
      ['Номенклатура', 'Розничный тип цен'],
      ['Игрушки', ''],
      ['Кукла новая Арт.st-917', '1 250,00'],
      ['Молоко', '95'],
      ['Чего нет', '10'],
    ]).recs }], catalog, []);
    expect(plan.products.map((p) => [p.id, p.retail_price])).toEqual([['k', 125000], ['m', 9500]]);
    expect(plan.stats).toMatchObject({ created: 0, changed: 2, unmatched: 1 });
  });

  it('несколько файлов: сначала цены (создают товар), потом штрихкоды к нему же', () => {
    const plan = buildImportPlan([
      { type: 'barcodes', recs: parseBarcodesReport([['Штрих код', 'Номенклатура'], ['4600000000046', 'Кефир 1%']]) },
      { type: 'prices', items: parsePriceReport([HEAD, ['Кефир 1%', '9', 'Молзавод', 'шт', '60', '01.08.2026', '']]) },
    ], [], []);
    expect(plan.products).toEqual([expect.objectContaining({ cash_code: '9', barcodes: ['4600000000046'] })]);
    expect(plan.stats.unmatched).toBe(0);
  });
});

describe('КАТ-6: продажи в плане загрузки', () => {
  const sales = (rows: unknown[][]) => {
    const { recs } = parseSalesReport([['Период: 01.09.2026 - 30.09.2026'], ['Номенклатура', 'Код', 'Количество', 'Сумма'], ...rows]);
    return { type: 'sales' as const, recs, period: { from: '2026-09-01', to: '2026-09-30' } };
  };
  it('товар по коду и по названию; один товар под двумя названиями суммируется; рубли → копейки', () => {
    const catalog = [product('p1', 'Сникерс 50г', { cashCode: '1463' }), product('p2', 'Молоко Чабан 1л')];
    const plan = buildImportPlan([sales([
      ['Snickers', '1 463', '3', '150,50'],
      ['Чабан Молоко 1л', '', '1,5', '90'],
      ['Молоко Чабан 1л', '', '1', ''],
      ['Неизвестный товар', '', '4', '400'],
    ])], catalog, []);
    expect(plan.sales).toEqual([{ from: '2026-09-01', to: '2026-09-30', rows: [
      { product_id: 'p1', qty: 3, amount: 15050 },
      { product_id: 'p2', qty: 2.5, amount: 9000 },
    ] }]);
    expect(plan.stats.unmatched).toBe(1);
    expect(plan.products).toEqual([]);
  });
  it('продажи находят товар, созданный в той же загрузке, и ничего не создают сами', () => {
    const plan = buildImportPlan([
      sales([['Хлеб', '', '2', '100']]),
      { type: 'prices', items: parsePriceReport([HEAD, ['Хлеб', '77', 'Пекарь', 'шт', '40', '02.09.2026', 'Выпечка']]) },
    ], [], []);
    expect(plan.products).toHaveLength(1);
    expect(plan.sales[0]?.rows).toEqual([{ product_id: plan.products[0]?.id, qty: 2, amount: 10000 }]);
  });
});
