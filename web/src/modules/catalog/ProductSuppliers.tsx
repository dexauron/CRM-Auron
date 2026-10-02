// Поставщики товара в карточке (основа ПСТ-8): кто поставляет и почём. Видят владелец, управляющий, бухгалтер;
// указать или убрать поставщика могут владелец и управляющий. Цены приходят из «Цен поставщиков» 1С.
import { useEffect, useState } from 'react';
import type { CatalogProduct } from '../../api/catalog';
import {
  linkProductSupplier, loadProductSuppliers, loadSuppliers, unlinkProductSupplier, type ProductSupplier, type Supplier,
} from '../../api/suppliers';
import { isoDay } from '../../shared/date';
import { ru } from '../../shared/i18n/ru';
import { Icon } from '../../shared/ui/icons';
import { Row, RowAction, Section } from '../../shared/ui/List';
import { formatPrice } from './format';

const t = ru.catalog.productSuppliers;

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; list: ProductSupplier[] };

export function ProductSuppliers({ product, editOrgId }: { product: CatalogProduct; editOrgId: string | null }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [choices, setChoices] = useState<Supplier[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    loadProductSuppliers(product.id).then((list) => active && setLoad({ kind: 'ready', list }), () => active && setLoad({ kind: 'error' }));
    return () => {
      active = false;
    };
  }, [product.id, attempt]);

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setFailed(false);
    try {
      await action();
      setChoices(null);
      setAttempt((n) => n + 1);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const openChoices = () => {
    if (!editOrgId) return;
    setBusy(true);
    loadSuppliers(editOrgId).then((all) => setChoices(all.filter((s) => !s.deleted)), () => setFailed(true)).finally(() => setBusy(false));
  };

  if (load.kind !== 'ready') {
    return (
      <Section title={t.title} id="product-suppliers">
        {load.kind === 'loading' ? (
          <Row leading={<span className="spinner" />} title={t.loading} tone="muted" />
        ) : (
          <div role="alert"><Row title={t.error} tone="bad" onClick={() => { setLoad({ kind: 'loading' }); setAttempt((n) => n + 1); }} /></div>
        )}
      </Section>
    );
  }

  const linked = new Set(load.list.map((s) => s.supplierId));
  const free = choices?.filter((s) => !linked.has(s.id)) ?? [];
  return (
    <Section title={t.title} id="product-suppliers" footer={failed ? t.failed : t.footer}>
      {load.list.length === 0 && <Row title={t.empty} tone="muted" />}
      {load.list.map((s) => (
        <Row key={s.supplierId} title={s.name}
          subtitle={s.price === null ? t.noPrice : t.price(formatPrice(s.price, product.unit), s.priceDate && isoDay(s.priceDate))}
          {...(editOrgId ? {
            trailing: <RowAction tone="bad" disabled={busy}
              onClick={() => void act(() => unlinkProductSupplier(product.id, s.supplierId))}>{t.remove}</RowAction>,
          } : {})} />
      ))}
      {editOrgId && choices === null && (
        <Row leading={<Icon name="plus" className="row-icon" />} title={t.add} tone="link" disabled={busy} onClick={openChoices} />
      )}
      {editOrgId && choices !== null && (free.length === 0 ? (
        <Row title={t.noSuppliers} tone="muted" onClick={() => setChoices(null)} />
      ) : (
        <label className="row row-inset-text row-select">
          <span className="row-main"><span className="row-title">{t.choose}</span></span>
          <span className="row-trailing">{t.pick}<Icon name="chevronUpDown" className="row-chevron" /></span>
          <select aria-label={t.choose} value="" disabled={busy}
            onChange={(e) => {
              const orgId = editOrgId;
              const id = e.target.value;
              if (id) void act(() => linkProductSupplier(orgId, product.id, id));
            }}>
            <option value="" disabled>{t.pick}</option>
            {free.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      ))}
    </Section>
  );
}
