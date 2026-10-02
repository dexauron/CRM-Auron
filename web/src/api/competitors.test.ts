import { describe, expect, it, vi } from 'vitest';
import { CompetitorsError, deleteCompetitorPrice, latestByCompetitor, parseCompetitorPrice, sameName, verdict, type CompetitorPrice } from './competitors';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('./client', () => ({ api: () => ({ from }) }));

const rec = (id: number, competitorId: string, price: number, observedOn: string): CompetitorPrice =>
  ({ id, competitorId, price, observedOn, createdBy: null });

describe('КАТ-6: цены конкурентов', () => {
  it('по каждому магазину — только самая свежая запись, сначала самые дешёвые', () => {
    const latest = latestByCompetitor([
      rec(5, 'b', 9500, '2026-10-01'), rec(4, 'a', 8800, '2026-10-01'), rec(3, 'b', 7000, '2026-08-01'), rec(2, 'a', 9900, '2026-10-01'),
    ]);
    expect(latest.map((p) => [p.competitorId, p.price])).toEqual([['a', 8800], ['b', 9500]]);
  });
  it('итог: у нас дешевле всех, столько же, дешевле у них; без нашей цены — ничего', () => {
    expect(verdict(9000, [rec(1, 'a', 9500, '2026-10-01')])).toMatchObject({ kind: 'cheapest', by: 500 });
    expect(verdict(9000, [rec(1, 'a', 9000, '2026-10-01')])).toMatchObject({ kind: 'same' });
    expect(verdict(9000, [rec(1, 'a', 8500, '2026-10-01'), rec(2, 'b', 9900, '2026-10-01')])).toMatchObject({ kind: 'cheaper_there', by: 500 });
    expect(verdict(null, [rec(1, 'a', 8500, '2026-10-01')])).toEqual({ kind: 'none' });
    expect(verdict(9000, [])).toEqual({ kind: 'none' });
  });
  it('название магазина без учёта регистра и пробелов по краям', () => {
    expect(sameName(' Магнит ', 'магнит')).toBe(true);
    expect(sameName('Магнит', 'Магнит у дома')).toBe(false);
  });
  it.each([
    { id: '1' }, { price: 0 }, { price: 1.5 }, { observed_on: '01.10.2026' }, { created_by: 5 },
  ])('отклоняет неверную запись %o', (bad) => {
    expect(() => parseCompetitorPrice({ id: 1, competitor_id: 'a', price: 100, observed_on: '2026-10-01', created_by: null, ...bad }))
      .toThrow(CompetitorsError);
  });
  it('удаление чужой записи (RLS ничего не нашёл) — отказ, а не успех', async () => {
    const chain = { delete: () => chain, eq: () => chain, select: () => Promise.resolve({ data: [], error: null }) };
    from.mockReturnValue(chain);
    await expect(deleteCompetitorPrice(7)).rejects.toMatchObject({ reason: 'forbidden' });
  });
});
