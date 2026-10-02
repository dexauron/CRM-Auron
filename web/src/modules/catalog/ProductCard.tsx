// Карточка товара (КАТ-1, КАТ-4): открытая часть видна всем, закупка, остаток и история цен —
// только владельцу, управляющему и бухгалтеру (сервер отдаёт их лишь этим ролям со вторым фактором).
import { useEffect, useState } from 'react';
import {
  loadPriceHistory,
  loadProductInternals,
  type CatalogProduct,
  type PriceChange,
  type ProductInternals,
} from '../../api/catalog';
import { formatDate, formatDay } from '../../shared/date';
import { ru } from '../../shared/i18n/ru';
import { Row, Section } from '../../shared/ui/List';
import { formatPrice, formatStock, markupPercent } from './format';
import type { CatalogGroup } from './search';

type Internal =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; internals: ProductInternals | null; history: PriceChange[] };

function Fact({ title, value }: { title: string; value: string }) {
  return <Row title={title} fact trailing={<span className="row-detail tone-muted">{value}</span>} />;
}

function InternalSections({ product }: { product: CatalogProduct }) {
  const [state, setState] = useState<Internal>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([loadProductInternals(product.id), loadPriceHistory(product.id)]).then(
      ([internals, history]) => active && setState({ kind: 'ready', internals, history }),
      () => active && setState({ kind: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [product.id, attempt]);

  const t = ru.catalog.card.internal;
  if (state.kind !== 'ready') {
    return (
      <Section title={t.title} id="internal-title" footer={t.footer}>
        {state.kind === 'loading' ? (
          <Row leading={<span className="spinner" />} title={t.loading} tone="muted" />
        ) : (
          <div role="alert">
            <Row
              title={t.error}
              tone="bad"
              onClick={() => {
                setState({ kind: 'loading' });
                setAttempt((n) => n + 1);
              }}
            />
          </div>
        )}
      </Section>
    );
  }

  const { internals, history } = state;
  const markup = markupPercent(product.retailPrice, internals?.purchasePrice ?? null);
  const hasFacts = internals && (internals.purchasePrice !== null || internals.stock !== null || internals.note);
  return (
    <>
      <Section title={t.title} id="internal-title" footer={t.footer}>
        {!hasFacts && <Row title={t.none} tone="muted" />}
        {internals?.purchasePrice != null && (
          <Fact title={t.purchase} value={formatPrice(internals.purchasePrice, product.unit)} />
        )}
        {markup !== null && (
          <Row
            title={t.markup}
            fact
            trailing={
              <span className={`row-detail ${markup < 0 ? 'tone-bad' : 'tone-muted'}`}>
                {markup < 0 ? `${markup} % · ${t.belowCost}` : `${markup} %`}
              </span>
            }
          />
        )}
        {internals?.stock != null && <Fact title={t.stock} value={formatStock(internals.stock, product.unit)} />}
        {internals?.note && <Row title={t.note} subtitle={internals.note} />}
      </Section>
      {history.length > 0 && (
        <Section title={ru.catalog.card.history.title} id="history-title">
          {history.map((h, i) => (
            <Row
              key={`${h.changedAt}-${i}`}
              title={h.price === null ? ru.catalog.card.history.removed : formatPrice(h.price, product.unit)}
              subtitle={ru.catalog.card.history[h.kind]}
              trailing={<span className="row-detail tone-muted">{formatDate(h.changedAt)}</span>}
            />
          ))}
        </Section>
      )}
    </>
  );
}

interface Props {
  product: CatalogProduct;
  group: CatalogGroup | null;
  /** Показывать закупку и остаток: человек — владелец, управляющий или бухгалтер этого магазина со вторым фактором. */
  privileged: boolean;
  onOpenGroup: (id: string) => void;
}

export function ProductCard({ product, group, privileged, onOpenGroup }: Props) {
  const t = ru.catalog.card;
  const stock = product.inStock === true ? ru.catalog.inStock : product.inStock === false ? ru.catalog.outOfStock : null;
  const unit = ru.catalog.units[product.unit] + (product.isWeighted ? `, ${t.weighted}` : '');
  return (
    <main>
      <Section footer={t.priceFooter}>
        <div className="product-hero">
          <span className="product-price">{formatPrice(product.retailPrice, product.unit)}</span>
          {stock && <span className={`pill ${product.inStock ? 'pill-good' : 'pill-muted'}`}>{stock}</span>}
        </div>
      </Section>

      <Section title={t.details} id="details-title">
        {product.cashCode && <Fact title={t.cashCode} value={product.cashCode} />}
        {product.article && <Fact title={t.article} value={product.article} />}
        {group && (
          <Row
            title={t.group}
            fact
            trailing={<span className="row-detail tone-muted">{group.name}</span>}
            chevron
            onClick={() => onOpenGroup(group.id)}
          />
        )}
        <Fact title={t.unit} value={unit} />
        {product.arrivalOn && <Fact title={t.arrival} value={formatDay(product.arrivalOn)} />}
      </Section>

      {product.barcodes.length > 0 && (
        <Section title={t.barcodes} id="barcodes-title">
          {product.barcodes.map((code) => (
            <Row key={code} title={<span className="code">{code}</span>} />
          ))}
        </Section>
      )}

      {privileged && <InternalSections product={product} />}
    </main>
  );
}
