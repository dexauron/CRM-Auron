// ПСТ-3: «Закончилось на полке» — кнопка в карточке товара и общий список магазина по поставщикам.
import { Fragment, useEffect, useState } from 'react';
import {
  groupBySupplier, loadOpenMark, loadRestock, markEmpty, markOrdered, RestockError, restockText, unmark, type RestockItem,
} from '../../api/restock';
import { createOrder } from '../../api/supplierOrders';
import { formatDate } from '../../shared/date';
import { ru } from '../../shared/i18n/ru';
import { Icon } from '../../shared/ui/icons';
import { Row, Section } from '../../shared/ui/List';

const t = ru.catalog.restock;

/** Отметить пустую полку или убрать отметку. Отметку видят все свои — список общий. */
export function RestockButton({ orgId, productId }: { orgId: string; productId: string }) {
  const [mark, setMark] = useState<string | null | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    loadOpenMark(productId).then((id) => active && setMark(id), () => active && setMark(null));
    return () => {
      active = false;
    };
  }, [productId]);

  if (mark === 'loading') return null;
  const toggle = async () => {
    setBusy(true);
    setFailed(false);
    try {
      if (mark) {
        await unmark(mark);
        setMark(null);
      } else {
        setMark(await markEmpty(orgId, productId));
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section footer={failed ? t.failed : mark ? t.markedFooter : t.markFooter}>
      {mark ? (
        <Row title={t.marked} subtitle={t.unmark} tone="good" disabled={busy} onClick={() => void toggle()} />
      ) : (
        <Row leading={<Icon name="plus" className="row-icon" />} title={t.mark} tone="link" disabled={busy} onClick={() => void toggle()} />
      )}
    </Section>
  );
}

type Load = { kind: 'loading' } | { kind: 'error'; denied: boolean } | { kind: 'ready'; items: RestockItem[] };

export function RestockList({ orgId, onOpenProduct, onOpenOrder }: {
  orgId: string;
  onOpenProduct: (id: string) => void;
  /** Оформили заказ — сразу открываем его, чтобы поправить количество и отправить поставщику. */
  onOpenOrder?: (id: string) => void;
}) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadRestock(orgId).then(
      (items) => active && setLoad({ kind: 'ready', items }),
      (error: unknown) => active && setLoad({ kind: 'error', denied: error instanceof RestockError && error.reason === 'forbidden' }),
    );
    return () => {
      active = false;
    };
  }, [orgId, attempt]);

  if (load.kind === 'loading') return <Section><Row leading={<span className="spinner" />} title={t.loading} tone="muted" /></Section>;
  if (load.kind === 'error') {
    return load.denied ? (
      <Section footer={t.denied}><Row title={t.noAccess} tone="muted" /></Section>
    ) : (
      <div role="alert"><Section><Row title={t.error} tone="bad" onClick={() => { setLoad({ kind: 'loading' }); setAttempt((n) => n + 1); }} /></Section></div>
    );
  }

  const groups = groupBySupplier(load.items);
  const waiting = load.items.filter((i) => !i.orderedAt).length;

  const ordered = async (ids: string[]) => {
    setBusy(true);
    setNote(null);
    try {
      await markOrdered(ids);
      setAttempt((n) => n + 1);
    } catch {
      setNote(t.failed);
    } finally {
      setBusy(false);
    }
  };

  /* Заказ оформляется прямо отсюда: иначе человеку пришлось бы переписывать список руками в
     другом разделе. По одной единице на товар — количество правят уже в заказе. */
  const order = async (supplierId: string, items: RestockItem[]) => {
    setBusy(true);
    setNote(null);
    try {
      const id = await createOrder(orgId, {
        supplierId,
        expectedAt: null,
        items: items.map((i) => ({ productId: i.productId, qty: 1 })),
        markIds: items.map((i) => i.id),
      });
      if (onOpenOrder) onOpenOrder(id);
      else setAttempt((n) => n + 1);
    } catch {
      setNote(ru.suppliers.orders.failed);
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    const text = restockText(groups, t.shareTitle, t.noSupplier);
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

  if (!load.items.length) return <Section footer={t.footer}><Row title={t.empty} tone="muted" /></Section>;
  return (
    <>
      <Section>
        <Row title={t.waiting(waiting)} tone="muted" />
      </Section>
      {groups.map((g) => {
        const open = g.items.filter((i) => !i.orderedAt).map((i) => i.id);
        return (
          <Section key={g.supplierId ?? 'none'} title={g.name ?? t.noSupplier} id={`restock-${g.supplierId ?? 'none'}`}>
            {g.items.map((i) => (
              <Fragment key={i.id}>
                <Row title={i.name} chevron tone={i.orderedAt ? 'muted' : 'default'} onClick={() => onOpenProduct(i.productId)}
                  subtitle={[i.cashCode && ru.catalog.code(i.cashCode), i.who, formatDate(i.createdAt),
                    i.orderedAt && t.ordered(formatDate(i.orderedAt))].filter(Boolean).join(' · ')} />
              </Fragment>
            ))}
            {open.length > 0 && g.supplierId && (
              <Row title={ru.suppliers.orders.createFromRestock} tone="link" disabled={busy}
                onClick={() => void order(g.supplierId as string, g.items.filter((i) => !i.orderedAt))} />
            )}
            {open.length > 0 && !g.supplierId && <Row title={ru.suppliers.orders.noSupplierOrder} tone="muted" />}
            {open.length > 0 && <Row title={t.markOrdered} tone="link" disabled={busy} onClick={() => void ordered(open)} />}
          </Section>
        );
      })}
      <Section footer={t.footer}>
        {waiting > 0 && <Row leading={<Icon name="share" className="row-icon" />} title={t.share} tone="link" onClick={() => void share()} />}
        {note && <div role="status"><Row title={note} tone="muted" /></div>}
      </Section>
    </>
  );
}
