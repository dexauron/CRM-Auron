// КАТ-2. Эталонные случаи старого каталога (dexauron/auron, catalog/tests/search-quality.js):
// что человек находит, набирая слово, код или с опечаткой. Скорость можно менять, выдачу — нет.
import { describe, expect, it } from 'vitest';
import { CatalogSearch, translit, type CatalogItem } from './search';

const item = (id: string, name: string, cashCode: string, groupId: string, extra: Partial<CatalogItem> = {}): CatalogItem => ({
  id,
  name,
  groupId,
  cashCode,
  article: null,
  barcodes: [],
  isWeighted: false,
  ...extra,
});

const items: CatalogItem[] = [
  item('p1', 'Молоко Простоквашино 3.2% 930мл', '100500', 'g1', { barcodes: ['4600000000011'] }),
  item('p2', 'Молоко Домик в деревне 2.5% 950мл', '100501', 'g1', { barcodes: ['4600000000028'] }),
  item('p3', 'Вода Святой источник 0,5л', '200100', 'g2'),
  item('p4', 'Водолей лимонад 1,5л', '200101', 'g2'),
  item('p5', 'Сок Добрый яблочный 1л', '200102', 'g2'),
  item('p6', 'Коктейль высокобелковый шоколад', '200103', 'g2'),
  item('p7', 'Рис Мистраль круглозерный 900г', '300100', 'g3'),
  item('p8', 'Ирис Кис-кис 250г', '300101', 'g4'),
  item('p9', 'Хот-дог классический', '400100', 'g5'),
  item('p10', 'Snickers батончик 50г', '400101', 'g4'),
  item('p11', 'Яшкино Печенье овсяное 300г', '400102', 'g4'),
  item('p12', 'Гвоздь строительный арт. 8816', '500100', 'g6', { isWeighted: true }),
  item('p13', 'Сыр Ламбер 500г', '500101', 'g1', { barcodes: ['4600000000035'] }),
];
const groups = [
  { id: 'g1', name: 'Молочные продукты' },
  { id: 'g2', name: 'Напитки' },
  { id: 'g3', name: 'Крупы' },
  { id: 'g4', name: 'Сладости' },
  { id: 'g5', name: 'Готовая еда' },
  { id: 'g6', name: 'Хозтовары' },
];
const engine = new CatalogSearch(items, groups);
const find = (q: string) => engine.search(q).map((p) => p.name);

describe('КАТ-2: качество поиска (эталон старого каталога)', () => {
  const cases: [string, string, string][] = [
    ['молоко', 'Молоко', 'находит товар по первому слову'],
    ['простоквашино', 'Молоко Простоквашино 3.2% 930мл', 'находит по слову в середине названия'],
    ['просток', 'Молоко Простоквашино 3.2% 930мл', 'находит по началу слова, не дописывая его'],
    ['вода', 'Вода Святой источник 0,5л', 'целое слово важнее куска: «вода» — это вода, а не «Водолей»'],
    ['сок', 'Сок Добрый яблочный 1л', '«сок» не лезет в «Высокобелковый»'],
    ['рис', 'Рис Мистраль круглозерный 900г', '«рис» не лезет в «Ирис»'],
    ['дог', 'Хот-дог классический', 'находит слово после дефиса'],
    ['хатдок', 'Хот-дог классический', 'прощает опечатку'],
    ['сникерс', 'Snickers батончик 50г', 'находит латиницу по русскому написанию'],
    ['snickers', 'Snickers батончик 50г', 'находит и по латинице'],
    ['печенье яшкино', 'Яшкино Печенье овсяное 300г', 'слова в любом порядке'],
    ['100500', 'Молоко Простоквашино 3.2% 930мл', 'находит по коду'],
    ['4600000000035', 'Сыр Ламбер 500г', 'находит по штрихкоду'],
    ['арт8816', 'Гвоздь строительный арт. 8816', 'находит артикул без знаков и пробелов'],
    ['ламбер', 'Сыр Ламбер 500г', 'находит по второму слову'],
  ];
  for (const [q, expected, why] of cases) {
    it(`«${q}» — ${why}`, () => {
      const top = find(q)[0] ?? '—';
      if (expected === 'Молоко') expect(top.startsWith('Молоко')).toBe(true);
      else expect(top).toBe(expected);
    });
  }

  it('«вода» не тащит хвост слабых совпадений', () => {
    expect(find('вода').length).toBeLessThanOrEqual(3);
  });
  it('бессмыслица честно ничего не находит', () => {
    expect(find('зюзюка')).toEqual([]);
  });
  it('оба молока находятся по общему слову', () => {
    expect(find('молоко')).toHaveLength(2);
  });
  it('по названию группы находятся её товары', () => {
    expect(find('напитки')).toEqual(expect.arrayContaining(['Вода Святой источник 0,5л', 'Сок Добрый яблочный 1л']));
  });
  it('«весовой» находит весовые товары', () => {
    expect(find('весовой')).toContain('Гвоздь строительный арт. 8816');
  });
  it('пустой запрос — пусто', () => {
    expect(find('   ')).toEqual([]);
  });
});

describe('транслит', () => {
  it('русские буквы → латиница, латиница без изменений', () => {
    expect(translit('сникерс')).toBe('snikers');
    expect(translit('snickers')).toBe('snickers');
    expect(translit('щука')).toBe('shuka');
  });
});

describe('КАТ-2: скорость на 50 000 товаров', () => {
  it('поиск словом, кодом и с опечаткой — быстро', () => {
    const words = ['молоко', 'кефир', 'хлеб', 'сыр', 'вода', 'сок', 'чай', 'кофе', 'печенье', 'шоколад', 'рис', 'гречка'];
    const brands = ['Простоквашино', 'Домик', 'Добрый', 'Мистраль', 'Яшкино', 'Alpen', 'Milka', 'Lipton', 'Jacobs'];
    const big: CatalogItem[] = Array.from({ length: 50_000 }, (_, i) =>
      item(`x${i}`, `${words[i % words.length]} ${brands[i % brands.length]} ${i % 900}г`, String(100000 + i), `g${(i % 6) + 1}`, {
        barcodes: [String(4600000000000 + i)],
      }),
    );
    const t0 = performance.now();
    const engine50k = new CatalogSearch(big, groups);
    engine50k.search('молоко');
    const built = performance.now() - t0;
    const times: number[] = [];
    for (const q of ['простоквашино', 'milka', 'милка', '4600000012345', 'шоколат', 'чай lipton']) {
      const t = performance.now();
      const res = engine50k.search(q);
      times.push(performance.now() - t);
      expect(res.length).toBeGreaterThan(0);
    }
    // Запас на медленный CI: на ноутбуке это единицы и десятки миллисекунд.
    expect(built).toBeLessThan(3000);
    expect(Math.max(...times)).toBeLessThan(1500);
  });
});
