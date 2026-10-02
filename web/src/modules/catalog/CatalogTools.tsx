import { useEffect, useState } from 'react';
import {
  CatalogToolsError, checkKinds, loadCatalogIssues, reportKinds, type CatalogIssue, type CatalogIssues, type IssueKind,
} from '../../api/catalogTools';
import { formatDate, formatPeriod, isoDay } from '../../shared/date';
import { ru } from '../../shared/i18n/ru';
import { Row, Section } from '../../shared/ui/List';
import { formatExactRub } from '../../shared/money';

const price = (kopecks: bigint | null, unit: 'pcs' | 'kg') =>
  kopecks === null ? '—' : formatExactRub(kopecks) + (unit === 'kg' ? ru.catalog.perKg : '');

/** Рост цены в процентах с одним знаком: 80 → 100 = «+25 %». */
const percent = (was: bigint, now: bigint) =>
  was > 0n ? `+${(Number(((now - was) * 1000n) / was) / 10).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}\u00a0%` : '—';

function details(item: CatalogIssue, kind: IssueKind): string {
  const t = ru.catalog.tools;
  if (kind === 'price_rise' && item.priceKind && item.oldPrice !== null && item.newPrice !== null) {
    return [
      t.rise(t.priceKinds[item.priceKind], price(item.oldPrice, item.unit), price(item.newPrice, item.unit)),
      item.priceKind === 'purchase' && t.shelf(price(item.retailPrice, item.unit)),
      item.changedAt && formatDate(item.changedAt),
    ].filter(Boolean).join(' · ');
  }
  if (kind === 'competitor_cheaper' && item.rival !== null && item.rivalPrice !== null && item.observedOn !== null) {
    return t.rivalLine(item.rival, price(item.rivalPrice, item.unit), isoDay(item.observedOn));
  }
  if (kind === 'bestsellers' && item.qty !== null) {
    return [item.cashCode && ru.catalog.code(item.cashCode),
      t.sold(item.qty.toLocaleString('ru-RU', { maximumFractionDigits: 3 }), item.unit)].filter(Boolean).join(' · ');
  }
  return [
    item.cashCode && ru.catalog.code(item.cashCode),
    item.barcode ? t.sharedBarcode(item.barcode, item.barcodeCount ?? 0) :
      item.purchasePrice !== null ? t.purchase(price(item.purchasePrice, item.unit)) : t.noPurchase,
  ].filter(Boolean).join(' · ');
}

function figure(item: CatalogIssue, kind: IssueKind) {
  if (kind === 'price_rise') {
    return <span className="price tone-bad">{item.oldPrice !== null && item.newPrice !== null ? percent(item.oldPrice, item.newPrice) : '—'}</span>;
  }
  if (kind === 'bestsellers') return <span className="price">{item.amount === null ? '—' : formatExactRub(item.amount)}</span>;
  if (kind === 'low_markup' && item.retailPrice !== null && item.purchasePrice !== null) {
    return <span className="price">{percent(item.purchasePrice, item.retailPrice)}</span>;
  }
  return <span className={`price ${kind === 'below_cost' || kind === 'competitor_cheaper' ? 'tone-bad' : ''}`}>{price(item.retailPrice, item.unit)}</span>;
}

type State = { kind: 'loading' } | { kind: 'error'; denied: boolean } | { kind: 'ready'; data: CatalogIssues };

/** Компонент перемонтируется при смене магазина, пользователя или фильтра: закрытые данные не переносятся. */
export function CatalogTools({ orgId, selected, onSelect, onOpenProduct }: {
  orgId: string;
  selected: IssueKind | null;
  onSelect: (kind: IssueKind) => void;
  onOpenProduct: (id: string) => void;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const t = ru.catalog.tools;

  useEffect(() => {
    const controller = new AbortController();
    void loadCatalogIssues(orgId, selected ?? 'missing_price', offset, controller.signal).then(
      (data) => { if (!controller.signal.aborted) setState({ kind: 'ready', data }); },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ kind: 'error', denied: error instanceof CatalogToolsError && error.reason === 'forbidden' });
      },
    );
    return () => controller.abort();
  }, [orgId, selected, offset, attempt]);

  const reload = (nextOffset: number) => {
    setState({ kind: 'loading' });
    setOffset(nextOffset);
    setAttempt((n) => n + 1);
  };

  if (state.kind === 'loading') return <Section><Row leading={<span className="spinner" />} title={t.loading} tone="muted" /></Section>;
  if (state.kind === 'error') return (
    <Section footer={state.denied ? t.denied : t.error}>
      <div role="alert"><Row title={state.denied ? t.noAccess : t.retry} tone={state.denied ? 'muted' : 'link'}
        {...(state.denied ? {} : { onClick: () => reload(0) })} /></div>
    </Section>
  );

  const { data } = state;
  const kindRow = (kind: IssueKind) => (
    <Row key={kind} title={t.names[kind]} trailing={<span className="row-detail">{data.counts[kind].toLocaleString('ru-RU')}</span>}
      chevron onClick={() => onSelect(kind)} />
  );
  if (!selected) return (
    <>
      <Section title={t.checks} id="tools-checks" footer={t.footer}>{checkKinds.map(kindRow)}</Section>
      <Section title={t.reports} id="tools-reports" footer={t.reportsFooter}>{reportKinds.map(kindRow)}</Section>
    </>
  );

  const description = selected === 'bestsellers' && data.salesPeriod
    ? t.salesFor(formatPeriod(data.salesPeriod.from, data.salesPeriod.to)) : t.descriptions[selected];
  const empty = offset > 0 ? t.pageGone
    : selected === 'price_rise' ? t.emptyRise : selected === 'bestsellers' && !data.salesPeriod ? t.noSales : t.empty;
  return (
    <>
      <Section footer={description}>
        {data.items.length === 0 && <Row title={empty} tone="muted" />}
        {data.items.map((item) => (
          <Row key={`${item.id}:${item.barcode ?? item.priceKind ?? ''}`} title={item.name} chevron onClick={() => onOpenProduct(item.id)}
            subtitle={details(item, selected)} trailing={figure(item, selected)} />
        ))}
      </Section>
      <Section footer={t.shown(Math.min(offset + data.items.length, data.total), data.total)}>
        {offset > 0 && <Row title={t.previous} tone="link" onClick={() => reload(Math.max(0, offset - 50))} />}
        {offset + data.items.length < data.total && <Row title={t.next} tone="link" onClick={() => reload(offset + 50)} />}
        <Row title={t.refresh} tone="link" onClick={() => reload(0)} />
      </Section>
    </>
  );
}
