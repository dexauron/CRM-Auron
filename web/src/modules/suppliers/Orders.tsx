// ПСТ-2: заказы поставщикам — список с календарём поставок и карточка заказа.
// Заказ ведут по шагам: создан → подтвердил поставщик → принят (с фактической суммой) или отменён.
// Деньги показываем только если сервер их отдал: сотруднику зала закупочные цены закрыты.
import { useCallback, useEffect, useState } from 'react';
import {
  canEditItems, loadOrder, loadOrders, nextStatuses, orderText, OrdersError, setOrderItems, setOrderStatus,
  type NextStatus, type OrderFull, type OrderLine, type OrderRow,
} from '../../api/supplierOrders';
import { formatDate } from '../../shared/date';
import { ru } from '../../shared/i18n/ru';
import { formatRub, parseRub } from '../../shared/money';
import { Icon } from '../../shared/ui/icons';
import { Row, RowAction, Section } from '../../shared/ui/List';

const t = ru.suppliers.orders;
const rub = (kopecks: number | null): string | null => (kopecks == null ? null : formatRub(kopecks));
/** «2026-10-09» → «09.10.2026»: заказ читает человек, а не машина. */
const day = (iso: string): string => iso.split('-').reverse().join('.');
const step = (unit: 'pcs' | 'kg'): number => (unit === 'kg' ? 0.1 : 1);
/** Килограммы считаем с точностью до 100 г: дробь после умножения иначе даёт 1,7000000000000002. */
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

type Load<T> = { kind: 'loading' } | { kind: 'error'; denied: boolean } | { kind: 'ready'; data: T };

function Loading({ text }: { text: string }) {
  return <Section><Row leading={<span className="spinner" />} title={text} tone="muted" /></Section>;
}

function Failed({ denied, onRetry }: { denied: boolean; onRetry: () => void }) {
  if (denied) return <Section footer={t.noAccessFooter}><Row title={t.noAccess} tone="muted" /></Section>;
  return (
    <div role="alert"><Section><Row title={t.error} tone="bad" onClick={onRetry} /></Section></div>
  );
}

/* Загрузка с сервера: «идёт», «не получилось» или данные. Список и карточка заказа грузились
 * двумя одинаковыми кусками, и тихое обновление (без мелькания «Загружаю…») пришлось бы писать
 * в обоих. Теперь загрузчик один:
 *   retry   — с видимым «Загружаю…», для повтора после ошибки;
 *   refresh — тихо, когда данные уже на экране: иначе карточка на мгновение исчезает вместе
 *             с сообщением «Количество сохранено», и человек не понимает, сохранилось ли. */
function useLoaded<T>(get: () => Promise<T>): { load: Load<T>; retry: () => void; refresh: () => void } {
  const [load, setLoad] = useState<Load<T>>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const take = useCallback((quiet: boolean) => {
    let active = true;
    get().then(
      (data) => active && setLoad({ kind: 'ready', data }),
      (e: unknown) => active && !quiet
        && setLoad({ kind: 'error', denied: e instanceof OrdersError && e.reason === 'forbidden' }),
    );
    return () => {
      active = false;
    };
  }, [get]);
  useEffect(() => take(false), [take, attempt]);
  const retry = useCallback(() => {
    setLoad({ kind: 'loading' });
    setAttempt((n) => n + 1);
  }, []);
  const refresh = useCallback(() => {
    take(true);
  }, [take]);
  return { load, retry, refresh };
}

function OrderLineRow({ order, onOpen }: { order: OrderRow; onOpen: () => void }) {
  const parts = [
    t.status[order.status],
    order.expectedAt ? `${t.expected} ${day(order.expectedAt)}` : t.noDate,
    order.overdue ? t.overdueMark : null,
    t.items(order.items),
    order.noPrice > 0 ? t.noPrice(order.noPrice) : null,
  ].filter(Boolean);
  const amount = order.status === 'received' ? order.amountActual : order.amount;
  return (
    <Row
      title={order.supplierName ?? t.cardTitle}
      subtitle={parts.join(' · ')}
      trailing={amount == null ? undefined : <span className="row-detail">{formatRub(amount)}</span>}
      tone={order.status === 'cancelled' ? 'muted' : order.overdue ? 'bad' : 'default'}
      chevron
      onClick={onOpen}
    />
  );
}

export function OrdersList({ orgId, onOpenOrder }: { orgId: string; onOpenOrder: (id: string) => void }) {
  const { load, retry } = useLoaded(useCallback(() => loadOrders(orgId), [orgId]));
  // Выбранный день календаря: показываем только его заказы, пока человек не нажмёт «Все дни».
  const [picked, setPicked] = useState<string | null>(null);

  if (load.kind === 'loading') return <Loading text={t.loading} />;
  if (load.kind === 'error') return <Failed denied={load.denied} onRetry={retry} />;

  const { orders, days, overdue, money } = load.data;
  if (!orders.length) return <Section footer={t.footer}><Row title={t.empty} tone="muted" /></Section>;
  const shown = picked ? orders.filter((o) => o.expectedAt === picked) : orders;

  return (
    <>
      {overdue.orders > 0 && (
        <Section title={t.overdue} id="orders-overdue">
          <Row title={t.overdueRow(overdue.orders, money ? rub(overdue.amount) : null)} tone="bad" />
        </Section>
      )}
      {days.length > 0 && (
        <Section title={t.calendar} id="orders-calendar">
          {days.map((d) => (
            <Row
              key={d.date}
              title={day(d.date)}
              subtitle={t.day(d.orders, money ? rub(d.amount) : null)}
              tone={d.overdue ? 'bad' : picked === d.date ? 'link' : 'default'}
              onClick={() => setPicked(picked === d.date ? null : d.date)}
            />
          ))}
          {picked && <Row title={t.allDays} tone="link" onClick={() => setPicked(null)} />}
        </Section>
      )}
      <Section title={t.list} id="orders-list" footer={t.footer}>
        {shown.map((o) => <OrderLineRow key={o.id} order={o} onOpen={() => onOpenOrder(o.id)} />)}
      </Section>
    </>
  );
}

/* Количество правят здесь же, строкой: отдельный экран для «6 штук вместо 4» — лишний шаг.
   Сохраняем целиком, одним действием: сервер и так заменяет состав целиком. */
function Composition({ orgId, order, canEdit, onSaved }:
  { orgId: string; order: OrderFull; canEdit: boolean; onSaved: () => void }) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const value = (id: string, fallback: number): number => qty[id] ?? fallback;
  const changed = order.items.some((i) => value(i.id, i.qty) !== i.qty);

  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      const lines: OrderLine[] = order.items.map((i) => ({
        productId: i.productId, name: i.name, qty: value(i.id, i.qty),
      }));
      await setOrderItems(orgId, order.id, lines);
      setNote(t.itemsSaved);
      setQty({});
      onSaved();
    } catch {
      setNote(t.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t.composition} id="order-items" footer={canEdit ? undefined : t.frozen}>
      {order.items.map((i) => {
        const now = value(i.id, i.qty);
        const unit = t.unit[i.unit];
        const sum = order.money && i.price != null ? formatRub(Math.round(now * i.price)) : null;
        return (
          <Row
            key={i.id}
            title={i.name}
            subtitle={[i.cashCode && ru.catalog.code(i.cashCode),
              `${now.toLocaleString('ru-RU')} ${unit}`,
              i.price != null ? formatRub(i.price) : null, sum].filter(Boolean).join(' · ')}
            trailing={canEdit ? (
              <span className="row-steppers" aria-label={t.qtyLabel(i.name)}>
                <RowAction onClick={() => setQty((q) => ({ ...q, [i.id]: Math.max(step(i.unit), round3(now - step(i.unit))) }))} disabled={busy}>
                  {t.less}
                </RowAction>
                <RowAction onClick={() => setQty((q) => ({ ...q, [i.id]: round3(now + step(i.unit)) }))} disabled={busy}>
                  {t.more}
                </RowAction>
              </span>
            ) : undefined}
          />
        );
      })}
      {canEdit && changed && <Row title={t.saveItems} tone="link" disabled={busy} onClick={() => void save()} />}
      {note && <div role="status"><Row title={note} tone="muted" /></div>}
    </Section>
  );
}

export function OrderCard({
  orgId, orderId, canManage, onChanged,
}: { orgId: string; orderId: string; canManage: boolean; onChanged?: () => void }) {
  const { load, retry, refresh } = useLoaded(useCallback(() => loadOrder(orgId, orderId), [orgId, orderId]));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (load.kind === 'loading') return <Loading text={t.loading} />;
  if (load.kind === 'error') return <Failed denied={load.denied} onRetry={retry} />;
  const order = load.data;

  const change = async (status: NextStatus) => {
    let amount: number | null = null;
    if (status === 'received') {
      const typed = window.prompt(t.askAmount, '');
      if (typed === null) return;
      amount = parseRub(typed);
      if (amount === null) {
        setNote(t.badAmount);
        return;
      }
    }
    if (status === 'cancelled' && !window.confirm(t.confirmCancel)) return;
    setBusy(true);
    setNote(null);
    try {
      await setOrderStatus(orgId, order.id, status, { amountActual: amount });
      refresh();
      onChanged?.();
    } catch {
      setNote(t.failed);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const text = orderText(order, { title: t.sendTitle, expected: t.expected, unit: t.unit, total: t.total });
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setNote(t.copied);
      }
    } catch {
      // Человек закрыл окно «Поделиться» — это не ошибка.
    }
  };

  return (
    <>
      <Section title={order.supplierName ?? t.cardTitle} id="order-head">
        <Row title={t.status[order.status]} fact
          trailing={<span className="row-detail">{order.expectedAt ? day(order.expectedAt) : t.noDate}</span>} />
        <Row title={t.created} trailing={<span className="row-detail">{formatDate(order.createdAt)}</span>} fact />
        {order.who && <Row title={t.who} trailing={<span className="row-detail">{order.who}</span>} fact />}
        {order.money && order.amount != null && (
          <Row title={t.amountPlanned} trailing={<span className="row-detail">{formatRub(order.amount)}</span>} fact />
        )}
        {order.money && order.amountActual != null && (
          <Row title={t.amountActual} trailing={<span className="row-detail">{formatRub(order.amountActual)}</span>} fact />
        )}
        {order.note && <Row title={t.note} subtitle={order.note} />}
      </Section>

      <Composition orgId={orgId} order={order} canEdit={canManage && canEditItems(order.status)} onSaved={refresh} />

      <Section footer={t.footer}>
        <Row leading={<Icon name="share" className="row-icon" />} title={t.send} tone="link" onClick={() => void send()} />
        {canManage && nextStatuses(order.status).map((s: NextStatus) => (
          <Row key={s} title={t.act[s]} tone={s === 'cancelled' ? 'bad' : 'link'} inset="icon"
            disabled={busy} onClick={() => void change(s)} />
        ))}
        {note && <div role="status"><Row title={note} tone="muted" /></div>}
      </Section>
    </>
  );
}
