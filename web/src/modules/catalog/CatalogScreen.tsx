// Каталог (КАТ-1, КАТ-2, КАТ-4): поиск как в iOS, группы, товары с ценой и наличием. Открыт и гостю.
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { loadCatalog, loadStore, type CatalogProduct } from '../../api/catalog';
import { STORE_SLUG } from '../../shared/config';
import { ru } from '../../shared/i18n/ru';
import { formatRub } from '../../shared/money';
import { Icon } from '../../shared/ui/icons';
import { LargeTitle } from '../../shared/ui/LargeTitle';
import { Row, Section } from '../../shared/ui/List';
import { CatalogSearch, type CatalogGroup } from './search';

type Load =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error' }
  | { kind: 'ready'; groups: CatalogGroup[]; products: CatalogProduct[] };

const PAGE = 50;
const collator = new Intl.Collator('ru');

function ProductRow({ product }: { product: CatalogProduct }) {
  const stock = product.inStock === true ? ru.catalog.inStock : product.inStock === false ? ru.catalog.outOfStock : null;
  const details = [product.cashCode && ru.catalog.code(product.cashCode), stock].filter(Boolean).join(' · ');
  const price = product.retailPrice === null ? '—' : formatRub(product.retailPrice) + (product.unit === 'kg' ? ru.catalog.perKg : '');
  return (
    <Row
      title={product.name}
      subtitle={details || undefined}
      tone={product.inStock === false ? 'muted' : 'default'}
      trailing={<span className="price">{price}</span>}
    />
  );
}

interface Props {
  /** Открытая группа (из адреса) или null — список групп. */
  groupId: string | null;
  onOpenGroup: (id: string) => void;
  /** Шаг назад: из группы — к группам, из каталога — на главную. */
  onBack: () => void;
}

export function CatalogScreen({ groupId, onOpenGroup, onBack }: Props) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    let active = true;
    (async () => {
      const store = await loadStore(STORE_SLUG);
      if (!store) return { kind: 'missing' } as const;
      return { kind: 'ready', ...(await loadCatalog(store.id)) } as const;
    })().then(
      (next) => active && setLoad(next),
      () => active && setLoad({ kind: 'error' }),
    );
    return () => {
      active = false;
    };
  }, []);

  const ready = load.kind === 'ready' ? load : null;
  const engine = useMemo(() => (ready ? new CatalogSearch(ready.products, ready.groups) : null), [ready]);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of ready?.products ?? []) if (p.groupId) map.set(p.groupId, (map.get(p.groupId) ?? 0) + 1);
    return map;
  }, [ready]);

  const results = useMemo(() => {
    if (!ready || !engine) return [];
    const q = deferredQuery.trim();
    if (q) return engine.search(q) as CatalogProduct[];
    if (groupId) return ready.products.filter((p) => p.groupId === groupId).sort((a, b) => collator.compare(a.name, b.name));
    return [];
  }, [ready, engine, deferredQuery, groupId]);

  const group = ready?.groups.find((g) => g.id === groupId) ?? null;
  const back = { label: group ? ru.catalog.title : ru.appName, onClick: onBack };
  const showGroups = ready && !query.trim() && !groupId;

  return (
    <>
      <LargeTitle title={group && !query ? group.name : ru.catalog.title} back={back} />
      <label className="search-field">
        <Icon name="search" />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
          placeholder={ru.catalog.searchPlaceholder}
          aria-label={ru.catalog.searchLabel}
          enterKeyHint="search"
          autoComplete="off"
        />
        {query && (
          <button type="button" className="search-clear" aria-label={ru.catalog.clear} onClick={() => setQuery('')}>
            <Icon name="clear" />
          </button>
        )}
      </label>

      <main>
        {load.kind === 'loading' && (
          <Section>
            <Row leading={<span className="spinner" />} title={ru.catalog.loading} tone="muted" />
          </Section>
        )}
        {load.kind === 'error' && (
          <p className="notice tone-bad" role="alert">
            <Icon name="warning" />
            {ru.catalog.error}
          </p>
        )}
        {load.kind === 'missing' && <Section footer={ru.catalog.missing}>{<Row title={ru.catalog.empty} tone="muted" />}</Section>}

        {showGroups && (
          <Section title={ru.catalog.groups} id="groups-title" footer={ru.catalog.total(ready.products.length)}>
            {ready.groups
              .filter((g) => counts.get(g.id))
              .map((g) => (
                <Row
                  key={g.id}
                  title={g.name}
                  trailing={<span className="row-detail">{counts.get(g.id)}</span>}
                  chevron
                  onClick={() => {
                    setLimit(PAGE);
                    onOpenGroup(g.id);
                  }}
                />
              ))}
          </Section>
        )}

        {ready && !showGroups && (
          <Section footer={results.length ? ru.catalog.found(results.length) : undefined}>
            {results.length === 0 ? (
              <Row title={ru.catalog.nothing} tone="muted" />
            ) : (
              results.slice(0, limit).map((p) => <ProductRow key={p.id} product={p} />)
            )}
            {results.length > limit && (
              <Row
                title={ru.catalog.more(results.length - limit)}
                tone="link"
                center
                onClick={() => setLimit((n) => n + PAGE * 2)}
              />
            )}
          </Section>
        )}
      </main>
    </>
  );
}
