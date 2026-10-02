// Каталог (КАТ-1…КАТ-4): поиск как в iOS, сканер штрихкода, группы, товары с ценой и наличием, карточка. Открыт и гостю.
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { loadCatalog, loadCatalogVersion, loadStore, type CatalogProduct, type Store } from '../../api/catalog';
import { importCatalog, type ImportTotals } from '../../api/importCatalog';
import { findByBarcode } from '../../shared/barcode';
import { STORE_SLUG } from '../../shared/config';
import { formatShortDateTime } from '../../shared/date';
import { ru } from '../../shared/i18n/ru';
import { Icon } from '../../shared/ui/icons';
import { LargeTitle } from '../../shared/ui/LargeTitle';
import { Scanner } from '../../shared/ui/Scanner';
import { scannerSupported } from '../../shared/scanner';
import { Row, Section } from '../../shared/ui/List';
import { formatPrice } from './format';
import { clearCatalog, readCachedCatalog, saveCatalog } from './catalogCache';
import { fetchOldCatalog } from './oldCatalog';
import { ProductCard } from './ProductCard';
import { CatalogSearch, type CatalogGroup } from './search';

type Load =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error' }
  | { kind: 'ready'; store: Store; groups: CatalogGroup[]; products: CatalogProduct[]; savedAt: string };

/** Свежесть показанного каталога: проверяем версию на сервере, свежий, или сети нет — показан сохранённый. */
type Sync = 'checking' | 'fresh' | 'offline';

type ImportState =
  | { kind: 'idle' }
  | { kind: 'confirm' }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'done'; totals: ImportTotals }
  | { kind: 'error' };

/** Перенос старого каталога — только владельцу и управляющему (со вторым фактором). */
function ImportSection({ storeId, onImported }: { storeId: string; onImported: () => void }) {
  const [state, setState] = useState<ImportState>({ kind: 'idle' });
  const run = async () => {
    setState({ kind: 'running', done: 0, total: 0 });
    try {
      const { groups, products } = await fetchOldCatalog();
      const totals = await importCatalog(storeId, groups, products, (done, total) => setState({ kind: 'running', done, total }));
      setState({ kind: 'done', totals });
      onImported();
    } catch {
      setState({ kind: 'error' });
    }
  };
  return (
    <Section title={ru.catalog.import.title} id="import-title" footer={ru.catalog.import.footer}>
      {state.kind === 'idle' && (
        <Row title={ru.catalog.import.old} tone="link" onClick={() => setState({ kind: 'confirm' })} />
      )}
      {state.kind === 'confirm' && (
        <>
          <Row title={ru.catalog.import.confirm} tone="link" onClick={() => void run()} />
          <Row title={ru.catalog.import.cancel} tone="muted" onClick={() => setState({ kind: 'idle' })} />
        </>
      )}
      {state.kind === 'running' && (
        <div role="status">
          <Row
            leading={<span className="spinner" />}
            title={state.total ? ru.catalog.import.progress(state.done, state.total) : ru.catalog.import.downloading}
            tone="muted"
          />
        </div>
      )}
      {state.kind === 'done' && (
        <div role="status">
          <Row title={ru.catalog.import.done(state.totals)} tone="good" />
        </div>
      )}
      {state.kind === 'error' && (
        <div role="alert">
          <Row title={ru.catalog.import.error} tone="bad" onClick={() => setState({ kind: 'idle' })} />
        </div>
      )}
    </Section>
  );
}

const PAGE = 50;
const collator = new Intl.Collator('ru');

function ProductRow({ product, onOpen }: { product: CatalogProduct; onOpen: (id: string) => void }) {
  const stock = product.inStock === true ? ru.catalog.inStock : product.inStock === false ? ru.catalog.outOfStock : null;
  const details = [product.cashCode && ru.catalog.code(product.cashCode), stock].filter(Boolean).join(' · ');
  return (
    <Row
      title={product.name}
      subtitle={details || undefined}
      tone={product.inStock === false ? 'muted' : 'default'}
      trailing={<span className="price">{formatPrice(product.retailPrice, product.unit)}</span>}
      onClick={() => onOpen(product.id)}
    />
  );
}

interface Props {
  /** Открытая группа (из адреса) или null — список групп. */
  groupId: string | null;
  /** Открытая карточка товара (из адреса) или null. */
  productId: string | null;
  onOpenGroup: (id: string) => void;
  onOpenProduct: (id: string) => void;
  /** Шаг назад: из карточки — к списку, из группы — к группам, из каталога — на главную. */
  onBack: () => void;
  /** Магазины, где человек может менять каталог (владелец, управляющий со вторым фактором). */
  editableOrgIds: readonly string[];
  /** Магазины, где человек видит закупку и остаток (владелец, управляющий, бухгалтер со вторым фактором). */
  privilegedOrgIds: readonly string[];
}

export function CatalogScreen({ groupId, productId, onOpenGroup, onOpenProduct, onBack, editableOrgIds, privilegedOrgIds }: Props) {
  const [reload, setReload] = useState(0);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [sync, setSync] = useState<Sync>('checking');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [scanning, setScanning] = useState(false);
  const deferredQuery = useDeferredValue(query);

  // Сначала каталог с устройства (сразу и без сети), потом сверка версии; скачиваем заново, только если изменился.
  useEffect(() => {
    let active = true;
    void (async () => {
      const cached = await readCachedCatalog(STORE_SLUG);
      if (!active) return;
      if (cached) {
        const { store, groups, products, savedAt } = cached;
        setLoad({ kind: 'ready', store, groups, products, savedAt });
      }
      setSync('checking');
      try {
        const store = await loadStore(STORE_SLUG);
        if (!active) return;
        if (!store) {
          void clearCatalog(STORE_SLUG);
          return setLoad({ kind: 'missing' });
        }
        const version = await loadCatalogVersion(store.id);
        if (!active) return;
        if (cached && version && cached.version === version && cached.store.id === store.id) return setSync('fresh');
        const data = await loadCatalog(store.id);
        if (!active) return;
        const savedAt = new Date().toISOString();
        if (version) void saveCatalog(STORE_SLUG, { version, savedAt, store, ...data });
        setLoad({ kind: 'ready', store, ...data, savedAt });
        setSync('fresh');
      } catch {
        if (!active) return;
        if (cached) setSync('offline');
        else setLoad({ kind: 'error' });
      }
    })();
    return () => {
      active = false;
    };
  }, [reload]);

  const ready = load.kind === 'ready' ? load : null;
  const products = ready?.products;
  const groups = ready?.groups;
  const engine = useMemo(() => (products && groups ? new CatalogSearch(products, groups) : null), [products, groups]);
  const byId = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products ?? []) if (p.groupId) map.set(p.groupId, (map.get(p.groupId) ?? 0) + 1);
    return map;
  }, [products]);

  const results = useMemo(() => {
    if (!ready || !engine) return [];
    const q = deferredQuery.trim();
    if (q) return engine.search(q) as CatalogProduct[];
    if (groupId) return ready.products.filter((p) => p.groupId === groupId).sort((a, b) => collator.compare(a.name, b.name));
    return [];
  }, [ready, engine, deferredQuery, groupId]);

  // Один товар со штрихкодом — сразу карточка; несколько или ни одного — поиск по коду.
  const onScanned = (code: string) => {
    setScanning(false);
    const matches = ready ? findByBarcode(ready.products, code) : [];
    const [only] = matches;
    if (only && matches.length === 1) return onOpenProduct(only.id);
    setQuery(code);
    setLimit(PAGE);
  };

  const group = ready?.groups.find((g) => g.id === groupId) ?? null;
  const back = { label: group ? ru.catalog.title : ru.appName, onClick: onBack };
  const showGroups = ready && !query.trim() && !groupId;

  // Состояние связи — только когда что-то не так: сети нет, показан каталог с устройства.
  const offlineNotice = sync === 'offline' && ready && (
    <p className="notice tone-warn" role="status">
      <Icon name="warning" />
      {ru.catalog.offline(formatShortDateTime(ready.savedAt))}
    </p>
  );

  if (productId) {
    const product = byId.get(productId) ?? null;
    const productGroup = product?.groupId ? (ready?.groups.find((g) => g.id === product.groupId) ?? null) : null;
    return (
      <>
        <LargeTitle
          title={product?.name ?? ru.catalog.title}
          back={{ label: group && !query.trim() ? group.name : ru.catalog.title, onClick: onBack }}
        />
        {offlineNotice}
        {load.kind === 'loading' && (
          <Section>
            <Row leading={<span className="spinner" />} title={ru.catalog.card.loading} tone="muted" />
          </Section>
        )}
        {load.kind === 'error' && (
          <p className="notice tone-bad" role="alert">
            <Icon name="warning" />
            {ru.catalog.error}
          </p>
        )}
        {(load.kind === 'missing' || (ready && !product)) && (
          <Section>
            <Row title={ru.catalog.card.notFound} tone="muted" />
          </Section>
        )}
        {ready && product && (
          <ProductCard
            product={product}
            group={productGroup}
            privileged={privilegedOrgIds.includes(ready.store.id)}
            onOpenGroup={(id) => {
              setQuery('');
              setLimit(PAGE);
              onOpenGroup(id);
            }}
          />
        )}
      </>
    );
  }

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
        {query ? (
          <button type="button" className="search-clear" aria-label={ru.catalog.clear} onClick={() => setQuery('')}>
            <Icon name="clear" />
          </button>
        ) : (
          ready &&
          scannerSupported() && (
            <button type="button" className="search-clear search-scan" aria-label={ru.scanner.open} onClick={() => setScanning(true)}>
              <Icon name="barcode" />
            </button>
          )
        )}
      </label>
      {scanning && <Scanner onCode={onScanned} onClose={() => setScanning(false)} />}

      <main>
        {offlineNotice}
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

        {showGroups && editableOrgIds.includes(ready.store.id) && (
          <ImportSection storeId={ready.store.id} onImported={() => setReload((n) => n + 1)} />
        )}

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
              results.slice(0, limit).map((p) => <ProductRow key={p.id} product={p} onOpen={onOpenProduct} />)
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
