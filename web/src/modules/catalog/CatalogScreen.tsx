// Каталог (КАТ-1…КАТ-4): поиск как в iOS, сканер штрихкода, группы, товары с ценой и наличием, карточка. Открыт и гостю.
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { loadCatalog, loadCatalogVersion, loadStore, type CatalogProduct, type Store } from '../../api/catalog';
import { importCatalog, type ImportTotals } from '../../api/importCatalog';
import { loadProductsWithPhotos, photoUrl } from '../../api/photos';
import type { IssueKind } from '../../api/catalogTools';
import { findByBarcode } from '../../shared/barcode';
import { STORE_SLUG } from '../../shared/config';
import { formatShortDateTime } from '../../shared/date';
import { keepAwake } from '../../shared/wakeLock';
import { ru } from '../../shared/i18n/ru';
import { Icon } from '../../shared/ui/icons';
import { LargeTitle } from '../../shared/ui/LargeTitle';
import { Scanner } from '../../shared/ui/Scanner';
import { scannerSupported } from '../../shared/scanner';
import { Row, Section } from '../../shared/ui/List';
import { formatPrice } from './format';
import { clearCatalog, readCachedCatalog, saveCatalog } from './catalogCache';
import { fetchOldCatalog } from './oldCatalog';
import { planPhotoTransfer, runPhotoTransfer, type TransferPlan } from './photoTransfer';
import { OneCImport } from './import1c/OneCImport';
import { ProductCard } from './ProductCard';
import { CatalogTools } from './CatalogTools';
import { RestockList } from './Restock';
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
  | { kind: 'photos-planning' }
  | { kind: 'photos-confirm'; plan: TransferPlan }
  | { kind: 'photos-running'; done: number; total: number }
  | { kind: 'photos-done'; text: string }
  | { kind: 'error' };

/** Перенос старого каталога и его фото — только владельцу и управляющему (со вторым фактором). */
function ImportSection({ storeId, products, onImported }: { storeId: string; products: readonly CatalogProduct[]; onImported: () => void }) {
  const [state, setState] = useState<ImportState>({ kind: 'idle' });
  const t = ru.catalog.import;
  const run = async () => {
    setState({ kind: 'running', done: 0, total: 0 });
    try {
      const { groups, products: rows } = await fetchOldCatalog();
      const totals = await importCatalog(storeId, groups, rows, (done, total) => setState({ kind: 'running', done, total }));
      setState({ kind: 'done', totals });
      onImported();
    } catch {
      setState({ kind: 'error' });
    }
  };
  const planPhotos = async () => {
    setState({ kind: 'photos-planning' });
    try {
      const [{ photos }, withPhotos] = await Promise.all([fetchOldCatalog(), loadProductsWithPhotos(storeId)]);
      const plan = planPhotoTransfer(photos, products, withPhotos);
      setState(plan.items.length ? { kind: 'photos-confirm', plan } : { kind: 'photos-done', text: t.photosNothing });
    } catch {
      setState({ kind: 'error' });
    }
  };
  const runPhotos = async (plan: TransferPlan) => {
    const total = plan.items.length;
    setState({ kind: 'photos-running', done: 0, total });
    const release = await keepAwake();
    try {
      const { done, failed } = await runPhotoTransfer(storeId, plan, (d, f) => setState({ kind: 'photos-running', done: d + f, total }));
      setState({ kind: 'photos-done', text: t.photosDone(done, failed, plan.otherHost) });
      onImported();
    } catch {
      setState({ kind: 'error' });
    } finally {
      release();
    }
  };
  const progress = (text: string) => (
    <div role="status">
      <Row leading={<span className="spinner" />} title={text} tone="muted" />
    </div>
  );
  return (
    <Section title={t.title} id="import-title" footer={t.footer}>
      {state.kind === 'idle' && (
        <>
          <Row title={t.old} tone="link" onClick={() => setState({ kind: 'confirm' })} />
          <Row title={t.photos} tone="link" onClick={() => void planPhotos()} />
        </>
      )}
      {state.kind === 'confirm' && (
        <>
          <Row title={t.confirm} tone="link" onClick={() => void run()} />
          <Row title={t.cancel} tone="muted" onClick={() => setState({ kind: 'idle' })} />
        </>
      )}
      {state.kind === 'photos-confirm' && (
        <>
          <Row title={t.photosConfirm(state.plan.items.length)} tone="link" onClick={() => void runPhotos(state.plan)} />
          <Row title={t.cancel} tone="muted" onClick={() => setState({ kind: 'idle' })} />
        </>
      )}
      {state.kind === 'running' && progress(state.total ? t.progress(state.done, state.total) : t.downloading)}
      {state.kind === 'photos-planning' && progress(t.photosPlanning)}
      {state.kind === 'photos-running' && progress(t.photosProgress(state.done, state.total))}
      {state.kind === 'done' && (
        <div role="status">
          <Row title={t.done(state.totals)} tone="good" onClick={() => setState({ kind: 'idle' })} />
        </div>
      )}
      {state.kind === 'photos-done' && (
        <div role="status">
          <Row title={state.text} tone="good" onClick={() => setState({ kind: 'idle' })} />
        </div>
      )}
      {state.kind === 'error' && (
        <div role="alert">
          <Row title={t.error} tone="bad" onClick={() => setState({ kind: 'idle' })} />
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
  const [photo] = product.photos;
  return (
    <Row
      leading={
        photo ? (
          <img className="thumb" src={photoUrl(photo.path, true)} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="thumb thumb-empty" aria-hidden="true">
            <Icon name="bag" />
          </span>
        )
      }
      inset="thumb"
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
  tools: boolean;
  issueKind: IssueKind | null;
  viewerId: string | null;
  accountLoading: boolean;
  onOpenTools: (kind: IssueKind | null) => void;
  onOpenGroup: (id: string) => void;
  onOpenProduct: (id: string) => void;
  /** Шаг назад: из карточки — к списку, из группы — к группам, из каталога — на главную. */
  onBack: () => void;
  /** Магазины, где человек может менять каталог (владелец, управляющий со вторым фактором). */
  editableOrgIds: readonly string[];
  /** Магазины, где человек видит закупку и остаток (владелец, управляющий, бухгалтер со вторым фактором). */
  privilegedOrgIds: readonly string[];
  /** Магазины, где человек — владелец со вторым фактором: закупку и остатки из 1С загружает только он. */
  ownerOrgIds: readonly string[];
  /** Магазины, где человек видит цены конкурентов (свои роли; сотруднику зала второй фактор не нужен). */
  rivalReaderOrgIds: readonly string[];
  /** …и может записать цену (все, кроме бухгалтера). */
  rivalWriterOrgIds: readonly string[];
  /** «Закончилось на полке» (ПСТ-3): открыт список. */
  restock: boolean;
  /** Магазины, где человек отмечает пустые полки (владелец, управляющий, сотрудник зала). */
  restockOrgIds: readonly string[];
  onOpenRestock: () => void;
  onOpenOrder: (id: string) => void;
}

export function CatalogScreen({ groupId, productId, tools, issueKind, viewerId, accountLoading, onOpenTools, onOpenGroup, onOpenProduct, onBack, editableOrgIds, privilegedOrgIds, ownerOrgIds, rivalReaderOrgIds, rivalWriterOrgIds, restock, restockOrgIds, onOpenRestock, onOpenOrder }: Props) {
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
      // После своего импорта копия на устройстве заведомо устарела — сразу берём каталог с сервера.
      const cached = reload === 0 ? await readCachedCatalog(STORE_SLUG) : null;
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

  const renderProduct = () => {
    const product = productId ? (byId.get(productId) ?? null) : null;
    const productGroup = product?.groupId ? (ready?.groups.find((g) => g.id === product.groupId) ?? null) : null;
    return (
      <>
        <LargeTitle
          title={product?.name ?? ru.catalog.title}
          back={{ label: restock ? ru.catalog.restock.title : tools ? (issueKind ? ru.catalog.tools.names[issueKind] : ru.catalog.tools.title) : group && !query.trim() ? group.name : ru.catalog.title, onClick: onBack }}
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
            editOrgId={editableOrgIds.includes(ready.store.id) ? ready.store.id : null}
            rivals={rivalReaderOrgIds.includes(ready.store.id) ? {
              orgId: ready.store.id,
              viewerId,
              canWrite: rivalWriterOrgIds.includes(ready.store.id),
              canManage: editableOrgIds.includes(ready.store.id),
            } : null}
            restockOrgId={restockOrgIds.includes(ready.store.id) ? ready.store.id : null}
            onPhotosChange={(photos) =>
              setLoad((prev) =>
                prev.kind === 'ready'
                  ? { ...prev, products: prev.products.map((p) => (p.id === product.id ? { ...p, photos } : p)) }
                  : prev,
              )
            }
            onOpenGroup={(id) => {
              setQuery('');
              setLimit(PAGE);
              onOpenGroup(id);
            }}
          />
        )}
      </>
    );
  };

  if (tools) {
    const allowed = ready && privilegedOrgIds.includes(ready.store.id);
    const t = ru.catalog.tools;
    return (
      <>
        {allowed && productId ? renderProduct() : <LargeTitle title={issueKind ? t.names[issueKind] : t.title}
          back={{ label: issueKind ? t.title : ru.catalog.title, onClick: onBack }} />}
        {/* Список остаётся смонтирован в карточке: «Назад» сохраняет фильтр и страницу. */}
        <main hidden={Boolean(allowed && productId)}>
          {load.kind === 'loading' || accountLoading ? (
            <Section><Row leading={<span className="spinner" />} title={t.loading} tone="muted" /></Section>
          ) : ready && allowed ? (
            <CatalogTools key={`${ready.store.id}:${viewerId ?? ''}:${issueKind ?? 'summary'}`}
              orgId={ready.store.id} selected={issueKind} onSelect={onOpenTools} onOpenProduct={onOpenProduct} />
          ) : load.kind === 'error' ? (
            <Section footer={t.error}><Row title={t.retry} tone="link" onClick={() => setReload((n) => n + 1)} /></Section>
          ) : (
            <Section footer={t.denied}><Row title={t.noAccess} tone="muted" /></Section>
          )}
        </main>
      </>
    );
  }

  if (restock) {
    const allowed = ready && restockOrgIds.includes(ready.store.id);
    const t = ru.catalog.restock;
    return (
      <>
        {allowed && productId ? renderProduct() : <LargeTitle title={t.title} back={{ label: ru.catalog.title, onClick: onBack }} />}
        {/* Список остаётся смонтирован под карточкой: «Назад» возвращает к тому же месту. */}
        <main hidden={Boolean(allowed && productId)}>
          {load.kind === 'loading' || accountLoading ? (
            <Section><Row leading={<span className="spinner" />} title={t.loading} tone="muted" /></Section>
          ) : ready && allowed ? (
            <RestockList key={`${ready.store.id}:${viewerId ?? ''}`} orgId={ready.store.id}
              onOpenProduct={onOpenProduct} onOpenOrder={onOpenOrder} />
          ) : (
            <Section footer={t.denied}><Row title={t.noAccess} tone="muted" /></Section>
          )}
        </main>
      </>
    );
  }

  if (productId) return renderProduct();

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

        {showGroups && (privilegedOrgIds.includes(ready.store.id) || restockOrgIds.includes(ready.store.id)) && (
          <Section>
            {restockOrgIds.includes(ready.store.id) && (
              <Row title={ru.catalog.restock.title} subtitle={ru.catalog.restock.hint} chevron onClick={onOpenRestock} />
            )}
            {privilegedOrgIds.includes(ready.store.id) && (
              <Row title={ru.catalog.tools.title} subtitle={ru.catalog.tools.hint} chevron onClick={() => onOpenTools(null)} />
            )}
          </Section>
        )}

        {showGroups && editableOrgIds.includes(ready.store.id) && (
          <ImportSection storeId={ready.store.id} products={ready.products} onImported={() => setReload((n) => n + 1)} />
        )}

        {showGroups && editableOrgIds.includes(ready.store.id) && (
          <OneCImport
            storeId={ready.store.id}
            products={ready.products}
            groups={ready.groups}
            canWriteInternals={ownerOrgIds.includes(ready.store.id)}
            refreshing={sync === 'checking'}
            onImported={() => setReload((n) => n + 1)}
          />
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
