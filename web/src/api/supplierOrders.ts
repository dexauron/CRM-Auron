// Этап 2, ПСТ-2: заказы поставщикам. Заказ — документ: его создают, подтверждают, принимают или отменяют,
// но не удаляют. Писать в таблицы напрямую нельзя — всё через серверные функции, поэтому цену в строке
// заказа подставляет сервер, а не браузер.
// Денег в ответе может не быть вовсе: сотруднику зала закупочные цены закрыты (матрица прав в docs/TZ.md).
import { api } from './client';
import { formatRub } from '../shared/money';

export const orderStatuses = ['created', 'confirmed', 'received', 'cancelled'] as const;
export type OrderStatus = (typeof orderStatuses)[number];
export const orderUnits = ['pcs', 'kg'] as const;
export type OrderUnit = (typeof orderUnits)[number];

export interface OrderRow {
  id: string;
  supplierId: string;
  supplierName: string | null;
  status: OrderStatus;
  /** Когда ждём поставку, `YYYY-MM-DD`; null — дата ещё не назначена. */
  expectedAt: string | null;
  createdAt: string;
  items: number;
  /** Примерная сумма в копейках; null — либо нет прав на деньги, либо цены неизвестны. */
  amount: number | null;
  /** Фактическая сумма приёмки, копейки. */
  amountActual: number | null;
  /** Сколько позиций без известной закупочной цены — сумма неполная. */
  noPrice: number;
  overdue: boolean;
}

export interface OrderDay {
  date: string;
  orders: number;
  amount: number | null;
  overdue: boolean;
}

export interface OrdersView {
  /** Отдаёт ли сервер деньги этой роли. */
  money: boolean;
  orders: OrderRow[];
  days: OrderDay[];
  overdue: { orders: number; amount: number | null };
}

export interface OrderItem {
  id: string;
  productId: string | null;
  name: string;
  cashCode: string | null;
  unit: OrderUnit;
  qty: number;
  price: number | null;
  sum: number | null;
}

export interface OrderFull extends Omit<OrderRow, 'items' | 'noPrice' | 'overdue'> {
  money: boolean;
  confirmedAt: string | null;
  closedAt: string | null;
  note: string | null;
  /** Кто оформил — только владельцу и управляющему. */
  who: string | null;
  items: OrderItem[];
}

export type OrdersReason = 'forbidden' | 'unavailable' | 'invalid' | 'empty' | 'tooMany'
  | 'noSupplier' | 'noOrder' | 'frozen' | 'closed' | 'badStatus' | 'needAmount' | 'badAmount';

export class OrdersError extends Error {
  constructor(readonly reason: OrdersReason) {
    super(reason);
    this.name = 'OrdersError';
  }
}

const HINTS: Record<string, OrdersReason> = {
  empty_order: 'empty', too_many: 'tooMany', no_supplier: 'noSupplier', no_order: 'noOrder',
  order_frozen: 'frozen', order_closed: 'closed', bad_status: 'badStatus',
  need_amount: 'needAmount', bad_amount: 'badAmount',
};

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const text = (v: unknown): v is string | null => v === null || typeof v === 'string';
const money = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isInteger(v));
const invalid = (): never => {
  throw new OrdersError('invalid');
};
function fail(error: { code?: string; hint?: string | null }): never {
  const byHint = error.hint ? HINTS[error.hint] : undefined;
  if (byHint) throw new OrdersError(byHint);
  throw new OrdersError(error.code === '42501' ? 'forbidden' : 'unavailable');
}

/* Сервер отдаёт числа как числа, но деньги — всегда целые копейки, а количество бывает дробным
   (полтора килограмма). Поэтому проверяем их по-разному: копейки должны быть целыми. */
export function parseOrderRow(row: unknown): OrderRow {
  if (!record(row) || typeof row.id !== 'string' || typeof row.supplier_id !== 'string'
    || !text(row.supplier_name) || !orderStatuses.includes(row.status as OrderStatus)
    || !text(row.expected_at) || typeof row.created_at !== 'string'
    || typeof row.items !== 'number' || !money(row.amount) || !money(row.amount_actual)
    || typeof row.no_price !== 'number' || typeof row.overdue !== 'boolean') return invalid();
  return {
    id: row.id, supplierId: row.supplier_id, supplierName: row.supplier_name,
    status: row.status as OrderStatus, expectedAt: row.expected_at, createdAt: row.created_at,
    items: row.items, amount: row.amount, amountActual: row.amount_actual,
    noPrice: row.no_price, overdue: row.overdue,
  };
}

export function parseOrdersView(value: unknown): OrdersView {
  if (!record(value) || typeof value.money !== 'boolean' || !Array.isArray(value.orders)
    || !Array.isArray(value.days) || !record(value.overdue)) return invalid();
  const over = value.overdue;
  if (typeof over.orders !== 'number' || !money(over.amount)) return invalid();
  const days = (value.days as unknown[]).map((d): OrderDay => {
    if (!record(d) || typeof d.date !== 'string' || typeof d.orders !== 'number'
      || !money(d.amount) || typeof d.overdue !== 'boolean') return invalid();
    return { date: d.date, orders: d.orders, amount: d.amount, overdue: d.overdue };
  });
  return {
    money: value.money,
    orders: (value.orders as unknown[]).map(parseOrderRow),
    days,
    overdue: { orders: over.orders, amount: over.amount },
  };
}

export function parseOrderItem(row: unknown): OrderItem {
  if (!record(row) || typeof row.id !== 'string' || !text(row.product_id) || typeof row.name !== 'string'
    || !text(row.cash_code) || !orderUnits.includes(row.unit as OrderUnit)
    || typeof row.qty !== 'number' || !(row.qty > 0)
    || !money(row.price) || !money(row.sum)) return invalid();
  return {
    id: row.id, productId: row.product_id, name: row.name, cashCode: row.cash_code,
    unit: row.unit as OrderUnit, qty: row.qty, price: row.price, sum: row.sum,
  };
}

export function parseOrder(value: unknown): OrderFull {
  if (!record(value) || typeof value.money !== 'boolean' || typeof value.id !== 'string'
    || typeof value.supplier_id !== 'string' || !text(value.supplier_name)
    || !orderStatuses.includes(value.status as OrderStatus) || !text(value.expected_at)
    || typeof value.created_at !== 'string' || !text(value.confirmed_at) || !text(value.closed_at)
    || !text(value.note) || !text(value.who) || !money(value.amount) || !money(value.amount_actual)
    || !Array.isArray(value.items)) return invalid();
  return {
    money: value.money, id: value.id, supplierId: value.supplier_id, supplierName: value.supplier_name,
    status: value.status as OrderStatus, expectedAt: value.expected_at, createdAt: value.created_at,
    confirmedAt: value.confirmed_at, closedAt: value.closed_at, note: value.note, who: value.who,
    amount: value.amount, amountActual: value.amount_actual,
    items: (value.items as unknown[]).map(parseOrderItem),
  };
}

export async function loadOrders(orgId: string, from?: string, to?: string): Promise<OrdersView> {
  const { data, error } = await api().rpc('supplier_orders_list', {
    p_org: orgId, p_from: from ?? null, p_to: to ?? null,
  });
  if (error) fail(error);
  return parseOrdersView(data);
}

export async function loadOrder(orgId: string, orderId: string): Promise<OrderFull> {
  const { data, error } = await api().rpc('supplier_order_get', { p_org: orgId, p_order: orderId });
  if (error) fail(error);
  return parseOrder(data);
}

export interface OrderLine {
  /** Товар из каталога; для позиции «от руки» — null и заполненное `name`. */
  productId: string | null;
  name?: string;
  qty: number;
}

const lines = (items: readonly OrderLine[]): unknown[] => items.map((i) => (
  i.productId ? { product_id: i.productId, qty: i.qty } : { name: i.name ?? '', qty: i.qty }
));

export interface NewOrder {
  supplierId: string;
  expectedAt: string | null;
  items: readonly OrderLine[];
  /** Отметки «Закончилось на полке», которые закрывает этот заказ. */
  markIds?: readonly string[];
  note?: string | null;
}

export async function createOrder(orgId: string, draft: NewOrder): Promise<string> {
  if (!draft.items.length) throw new OrdersError('empty');
  const { data, error } = await api().rpc('supplier_order_create', {
    p_org: orgId, p_supplier: draft.supplierId, p_expected_at: draft.expectedAt,
    p_items: lines(draft.items), p_marks: draft.markIds?.length ? [...draft.markIds] : null,
    p_note: draft.note ?? null,
  });
  if (error) fail(error);
  if (typeof data !== 'string') return invalid();
  return data;
}

export async function setOrderItems(orgId: string, orderId: string, items: readonly OrderLine[]): Promise<void> {
  if (!items.length) throw new OrdersError('empty');
  const { error } = await api().rpc('supplier_order_items_set', {
    p_org: orgId, p_order: orderId, p_items: lines(items),
  });
  if (error) fail(error);
}

export async function setOrderStatus(
  orgId: string, orderId: string, status: OrderStatus,
  options: { amountActual?: number | null; expectedAt?: string | null } = {},
): Promise<void> {
  if (status === 'received' && options.amountActual == null) throw new OrdersError('needAmount');
  const { error } = await api().rpc('supplier_order_status_set', {
    p_org: orgId, p_order: orderId, p_status: status,
    p_amount_actual: status === 'received' ? options.amountActual : null,
    p_expected_at: options.expectedAt ?? null,
  });
  if (error) fail(error);
}

export async function setOrderNote(orgId: string, orderId: string, note: string | null): Promise<void> {
  const { error } = await api().rpc('supplier_order_note_set', { p_org: orgId, p_order: orderId, p_note: note });
  if (error) fail(error);
}

/* Что ещё можно сделать с заказом. Принятый и отменённый — закрыты, их не меняют, и вернуться
   в «создан» нельзя: иначе заказ перестаёт быть доказательством того, что происходило. */
export type NextStatus = Exclude<OrderStatus, 'created'>;

export function nextStatuses(status: OrderStatus): NextStatus[] {
  if (status === 'created') return ['confirmed', 'cancelled'];
  if (status === 'confirmed') return ['received', 'cancelled'];
  return [];
}

export const canEditItems = (status: OrderStatus): boolean => status === 'created';

/* Заказ поставщику уходит текстом в мессенджер: у многих поставщиков никакой системы нет, а
   сообщение прочитает любой. Количество — с единицей, иначе «сыр 2» непонятно: две головки или два кило. */
export function orderText(
  order: OrderFull,
  labels: { title: string; expected: string; unit: Record<OrderUnit, string>; total: string },
): string {
  const out = [`${labels.title}${order.supplierName ? `: ${order.supplierName}` : ''}`];
  if (order.expectedAt) out.push(`${labels.expected}: ${order.expectedAt.split('-').reverse().join('.')}`);
  out.push('');
  for (const [i, item] of order.items.entries()) {
    const qty = `${item.qty.toLocaleString('ru-RU')} ${labels.unit[item.unit]}`;
    out.push(`${i + 1}. ${item.name}${item.cashCode ? ` (код ${item.cashCode})` : ''} — ${qty}`);
  }
  if (order.money && order.amount != null) out.push('', `${labels.total}: ${formatRub(order.amount)}`);
  if (order.note) out.push('', order.note);
  return out.join('\n');
}
