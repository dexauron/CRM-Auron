import { useEffect, useState } from 'react';
import { CatalogToolsError, issueKinds, loadCatalogIssues, type CatalogIssues, type IssueKind } from '../../api/catalogTools';
import { ru } from '../../shared/i18n/ru';
import { Row, Section } from '../../shared/ui/List';
import { formatExactRub } from '../../shared/money';

const price = (kopecks: bigint | null, unit: 'pcs' | 'kg') =>
  kopecks === null ? '—' : formatExactRub(kopecks) + (unit === 'kg' ? ru.catalog.perKg : '');

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
  if (!selected) return (
    <Section footer={t.footer}>
      {issueKinds.map((kind) => <Row key={kind} title={t.names[kind]}
        trailing={<span className="row-detail">{data.counts[kind].toLocaleString('ru-RU')}</span>}
        chevron onClick={() => onSelect(kind)} />)}
    </Section>
  );

  return (
    <>
      <Section footer={t.descriptions[selected]}>
        {data.items.length === 0 && <Row title={offset === 0 ? t.empty : t.pageGone} tone="muted" />}
        {data.items.map((item) => (
          <Row key={`${item.id}:${item.barcode ?? ''}`} title={item.name} chevron onClick={() => onOpenProduct(item.id)}
            subtitle={[
              item.cashCode && ru.catalog.code(item.cashCode),
              item.barcode ? t.sharedBarcode(item.barcode, item.barcodeCount ?? 0) :
                item.purchasePrice !== null ? t.purchase(price(item.purchasePrice, item.unit)) : t.noPurchase,
            ].filter(Boolean).join(' · ')}
            trailing={<span className={`price ${selected === 'below_cost' ? 'tone-bad' : ''}`}>{price(item.retailPrice, item.unit)}</span>} />
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
