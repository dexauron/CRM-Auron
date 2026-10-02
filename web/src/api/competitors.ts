// КАТ-6: цены конкурентов. Закрытые сведения магазина: читаются по запросу, на устройстве не сохраняются.
// Права решает сервер (RLS): видят владелец, управляющий, бухгалтер и сотрудник зала; записывают все они,
// кроме бухгалтера; удалить — свою запись, а владелец и управляющий — любую.
import { api } from './client';
import { isKopecks, type Kopecks } from '../shared/money';

export interface Competitor {
  id: string;
  name: string;
}

export interface CompetitorPrice {
  id: number;
  competitorId: string;
  price: Kopecks;
  /** День, когда цену видели в магазине: «2026-10-02». */
  observedOn: string;
  createdBy: string | null;
}

export class CompetitorsError extends Error {
  constructor(readonly reason: 'forbidden' | 'unavailable' | 'invalid') {
    super(reason);
    this.name = 'CompetitorsError';
  }
}

const day = /^\d{4}-\d{2}-\d{2}$/;
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const fail = (code: string | undefined): never => {
  throw new CompetitorsError(code === '42501' ? 'forbidden' : 'unavailable');
};

export function parseCompetitor(row: unknown): Competitor {
  if (!record(row) || typeof row.id !== 'string' || typeof row.name !== 'string') throw new CompetitorsError('invalid');
  return { id: row.id, name: row.name };
}

export function parseCompetitorPrice(row: unknown): CompetitorPrice {
  if (!record(row) || typeof row.id !== 'number' || typeof row.competitor_id !== 'string'
    || typeof row.price !== 'number' || !isKopecks(row.price) || row.price <= 0
    || typeof row.observed_on !== 'string' || !day.test(row.observed_on)
    || !(row.created_by === null || typeof row.created_by === 'string')) throw new CompetitorsError('invalid');
  return { id: row.id, competitorId: row.competitor_id, price: row.price, observedOn: row.observed_on, createdBy: row.created_by };
}

/** Одинаковые названия магазинов: «Магнит» = « магнит » (так же сравнивает сервер). */
export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export async function loadCompetitors(orgId: string): Promise<Competitor[]> {
  const { data, error } = await api().from('competitors').select('id, name').eq('org_id', orgId).order('name');
  if (error) fail(error.code);
  return (data ?? []).map(parseCompetitor);
}

const PRICE_COLUMNS = 'id, competitor_id, price, observed_on, created_by';

export async function loadCompetitorPrices(productId: string): Promise<CompetitorPrice[]> {
  const { data, error } = await api().from('competitor_prices').select(PRICE_COLUMNS)
    .eq('product_id', productId).order('observed_on', { ascending: false }).order('id', { ascending: false }).limit(200);
  if (error) fail(error.code);
  return (data ?? []).map(parseCompetitorPrice);
}

/** Новый магазин; если такой уже записан (в другом регистре), возвращает существующий. */
export async function addCompetitor(orgId: string, name: string): Promise<Competitor> {
  const { data, error } = await api().from('competitors').insert({ org_id: orgId, name: name.trim() }).select('id, name').single();
  if (!error) return parseCompetitor(data);
  if (error.code !== '23505') fail(error.code);
  const existing = (await loadCompetitors(orgId)).find((c) => sameName(c.name, name));
  if (!existing) throw new CompetitorsError('unavailable');
  return existing;
}

export async function addCompetitorPrice(
  orgId: string, productId: string, competitorId: string, price: Kopecks, observedOn: string,
): Promise<CompetitorPrice> {
  const { data, error } = await api().from('competitor_prices')
    .insert({ org_id: orgId, product_id: productId, competitor_id: competitorId, price, observed_on: observedOn })
    .select(PRICE_COLUMNS).single();
  if (error) fail(error.code);
  return parseCompetitorPrice(data);
}

export async function deleteCompetitorPrice(id: number): Promise<void> {
  const { data, error } = await api().from('competitor_prices').delete().eq('id', id).select('id');
  if (error) fail(error.code);
  // Чужую запись RLS просто не находит — это отказ, а не успех.
  if (!data?.length) throw new CompetitorsError('forbidden');
}

/** Самая свежая запись каждого магазина (список уже отсортирован сервером: новые сверху). */
export function latestByCompetitor(prices: readonly CompetitorPrice[]): CompetitorPrice[] {
  const seen = new Map<string, CompetitorPrice>();
  for (const p of prices) {
    const cur = seen.get(p.competitorId);
    if (!cur || p.observedOn > cur.observedOn || (p.observedOn === cur.observedOn && p.id > cur.id)) seen.set(p.competitorId, p);
  }
  return [...seen.values()].sort((a, b) => a.price - b.price || (a.observedOn < b.observedOn ? 1 : -1));
}

export type Verdict =
  | { kind: 'none' }
  | { kind: 'cheapest'; by: Kopecks; rival: CompetitorPrice }
  | { kind: 'same'; rival: CompetitorPrice }
  | { kind: 'cheaper_there'; by: Kopecks; rival: CompetitorPrice };

/** Итог одной строкой: сравниваем нашу цену с самой низкой из свежих цен магазинов. */
export function verdict(ours: Kopecks | null, latest: readonly CompetitorPrice[]): Verdict {
  const cheapest = latest[0];
  if (ours === null || ours <= 0 || !cheapest) return { kind: 'none' };
  if (cheapest.price > ours) return { kind: 'cheapest', by: cheapest.price - ours, rival: cheapest };
  if (cheapest.price === ours) return { kind: 'same', rival: cheapest };
  return { kind: 'cheaper_there', by: ours - cheapest.price, rival: cheapest };
}
