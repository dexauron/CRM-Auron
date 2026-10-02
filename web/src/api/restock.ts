// ПСТ-3: «Закончилось на полке» — общий список магазина. Отмечают владелец, управляющий и сотрудник зала;
// поставщик товара приходит из сервера названием, без цен (сотруднику они закрыты).
import { api } from './client';

export interface RestockItem {
  id: string;
  productId: string;
  name: string;
  cashCode: string | null;
  createdAt: string;
  orderedAt: string | null;
  /** Кто отметил — только владельцу и управляющему. */
  who: string | null;
  supplierId: string | null;
  supplierName: string | null;
}

export interface RestockGroup {
  supplierId: string | null;
  name: string | null;
  items: RestockItem[];
}

export class RestockError extends Error {
  constructor(readonly reason: 'forbidden' | 'unavailable' | 'invalid') {
    super(reason);
    this.name = 'RestockError';
  }
}

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const text = (v: unknown): v is string | null => v === null || typeof v === 'string';
const fail = (code: string | undefined): never => {
  throw new RestockError(code === '42501' ? 'forbidden' : 'unavailable');
};

export function parseRestock(value: unknown): RestockItem[] {
  if (!Array.isArray(value)) throw new RestockError('invalid');
  return value.map((row: unknown): RestockItem => {
    if (!record(row) || typeof row.id !== 'string' || typeof row.product_id !== 'string' || typeof row.name !== 'string'
      || !text(row.cash_code) || typeof row.created_at !== 'string' || !text(row.ordered_at) || !text(row.who)
      || !text(row.supplier_id) || !text(row.supplier_name)) throw new RestockError('invalid');
    return {
      id: row.id, productId: row.product_id, name: row.name, cashCode: row.cash_code, createdAt: row.created_at,
      orderedAt: row.ordered_at, who: row.who, supplierId: row.supplier_id, supplierName: row.supplier_name,
    };
  });
}

export async function loadRestock(orgId: string): Promise<RestockItem[]> {
  const { data, error } = await api().rpc('restock_list', { p_org: orgId });
  if (error) fail(error.code);
  return parseRestock(data);
}

/** Открытая отметка товара (не заказан) или null. */
export async function loadOpenMark(productId: string): Promise<string | null> {
  const { data, error } = await api().from('restock_marks').select('id').eq('product_id', productId).is('ordered_at', null).maybeSingle();
  if (error) fail(error.code);
  return record(data) && typeof data.id === 'string' ? data.id : null;
}

/** Отметить пустую полку; если товар уже в списке (отметил коллега) — вернуть его отметку. */
export async function markEmpty(orgId: string, productId: string): Promise<string> {
  const { data, error } = await api().from('restock_marks').insert({ org_id: orgId, product_id: productId }).select('id').single();
  if (!error && record(data) && typeof data.id === 'string') return data.id;
  if (error?.code === '23505') {
    const existing = await loadOpenMark(productId);
    if (existing) return existing;
  }
  return fail(error?.code);
}

export async function unmark(markId: string): Promise<void> {
  const { data, error } = await api().from('restock_marks').delete().eq('id', markId).select('id');
  if (error) fail(error.code);
  if (!data?.length) throw new RestockError('forbidden');
}

export async function markOrdered(markIds: readonly string[]): Promise<void> {
  if (!markIds.length) return;
  const { error } = await api().from('restock_marks').update({ ordered_at: new Date().toISOString() }).in('id', [...markIds]);
  if (error) fail(error.code);
}

/** По поставщикам, «без поставщика» — в конце; внутри — сначала то, что ещё не заказано. */
export function groupBySupplier(items: readonly RestockItem[]): RestockGroup[] {
  const groups = new Map<string, RestockGroup>();
  for (const item of items) {
    const key = item.supplierId ?? '';
    const group = groups.get(key) ?? { supplierId: item.supplierId, name: item.supplierName, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  for (const g of groups.values()) {
    g.items.sort((a, b) => Number(a.orderedAt !== null) - Number(b.orderedAt !== null) || a.name.localeCompare(b.name, 'ru'));
  }
  return [...groups.values()].sort((a, b) =>
    a.name === null ? 1 : b.name === null ? -1 : a.name.localeCompare(b.name, 'ru'));
}

/** Текст для мессенджера: что закончилось, по поставщикам (только не заказанное). */
export function restockText(groups: readonly RestockGroup[], title: string, noSupplier: string): string {
  const lines = [title];
  for (const g of groups) {
    const open = g.items.filter((i) => !i.orderedAt);
    if (!open.length) continue;
    lines.push('', `${g.name ?? noSupplier}:`);
    for (const i of open) lines.push(`— ${i.name}${i.cashCode ? ` (код ${i.cashCode})` : ''}`);
  }
  return lines.join('\n');
}
