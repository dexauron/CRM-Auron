// Выгрузки 1С (КАТ-5): выбрать файлы → увидеть, что узнано и что изменится → загрузить.
// Владельцу и управляющему; закупку, остатки и продажи — только владелец (так же решает сервер).
import { useRef, useState } from 'react';
import type { CatalogProduct } from '../../../api/catalog';
import { importCatalog, importInternals, importSales } from '../../../api/importCatalog';
import { importSupplierPrices, realDataAllowed } from '../../../api/suppliers';
import { ru } from '../../../shared/i18n/ru';
import { Row, Section } from '../../../shared/ui/List';
import { formatPeriod } from '../../../shared/date';
import { keepAwake } from '../../../shared/wakeLock';
import type { CatalogGroup } from '../search';
import { buildImportPlan, type ImportPlan, type ParsedReport } from './plan';
import { readReport, type FileResult } from './read';

type State =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'confirm'; files: FileResult[]; plan: ImportPlan; realData: boolean }
  | { kind: 'running'; text: string }
  | { kind: 'done'; text: string }
  | { kind: 'error' };

interface Props {
  storeId: string;
  products: readonly CatalogProduct[];
  groups: readonly CatalogGroup[];
  /** Владелец: может загружать закупку, остатки и продажи. */
  canWriteInternals: boolean;
  /** Каталог ещё сверяется с сервером: план по старой копии показал бы неверные числа. */
  refreshing: boolean;
  onImported: () => void;
}

export function OneCImport({ storeId, products, groups, canWriteInternals, refreshing, onImported }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const t = ru.catalog.import;

  const read = async (list: FileList) => {
    setState({ kind: 'reading' });
    const files: FileResult[] = [];
    for (const file of Array.from(list)) files.push(await readReport(file));
    const reports = files.flatMap((f): ParsedReport[] => (f.report ? [f.report] : []));
    // Поставщики из 1С — только там, где разрешены настоящие данные (названия ИП — персональные данные).
    const realData = canWriteInternals ? await realDataAllowed().catch(() => false) : false;
    setState({ kind: 'confirm', files, plan: buildImportPlan(reports, products, groups), realData });
  };

  const run = async (plan: ImportPlan, realData: boolean) => {
    const release = await keepAwake();
    try {
      setState({ kind: 'running', text: t.oneCProgressProducts(0, plan.products.length) });
      if (plan.products.length || plan.groups.length) {
        await importCatalog(storeId, plan.groups, plan.products, (done, total) =>
          setState({ kind: 'running', text: t.oneCProgressProducts(done, total) }));
      }
      let internals = 0;
      if (canWriteInternals && plan.internals.length) {
        const totals = await importInternals(storeId, plan.internals, (done, total) =>
          setState({ kind: 'running', text: t.oneCProgressInternals(done, total) }));
        internals = totals.changed;
      }
      let sold = 0;
      if (canWriteInternals) {
        for (const sales of plan.sales) {
          if (!sales.rows.length) continue;
          sold += await importSales(storeId, sales, sales.rows, (done, total) =>
            setState({ kind: 'running', text: t.oneCProgressSales(done, total) }));
        }
      }
      let suppliers = 0;
      if (canWriteInternals && realData && plan.supplierPrices.length) {
        suppliers = await importSupplierPrices(storeId, plan.supplierPrices, (done, total) =>
          setState({ kind: 'running', text: t.oneCProgressSuppliers(done, total) }));
      }
      setState({ kind: 'done', text: t.oneCDone(plan.stats.created, plan.stats.changed, internals, sold, suppliers) });
      onImported();
    } catch {
      setState({ kind: 'error' });
    } finally {
      release();
    }
  };

  const status = (text: string, spinner = false) => (
    <div role="status">
      <Row leading={spinner ? <span className="spinner" /> : undefined} title={text} tone={spinner ? 'muted' : 'good'}
        {...(spinner ? {} : { onClick: () => setState({ kind: 'idle' }) })} />
    </div>
  );

  return (
    <Section title={t.oneCTitle} id="onec-title" footer={t.oneCFooter}>
      {state.kind === 'idle' && (
        <Row
          title={t.oneC}
          {...(refreshing ? { subtitle: t.oneCWait } : {})}
          tone="link"
          disabled={refreshing}
          onClick={() => input.current?.click()}
        />
      )}
      {state.kind === 'reading' && status(t.oneCReading, true)}
      {state.kind === 'running' && status(state.text, true)}
      {state.kind === 'done' && status(state.text)}
      {state.kind === 'error' && (
        <div role="alert">
          <Row title={t.error} tone="bad" onClick={() => setState({ kind: 'idle' })} />
        </div>
      )}
      {state.kind === 'confirm' && (
        <>
          {state.files.map((f) => (
            <Row
              key={f.fileName}
              title={f.fileName}
              subtitle={f.error ?? (f.type ? `${t.oneCTypes[f.type]}${f.report ? ` · ${t.oneCRows(f.rows)}` : ''}` : t.oneCUnknown)}
              tone={f.report ? 'default' : 'muted'}
            />
          ))}
          <PlanSummary plan={state.plan} canWriteInternals={canWriteInternals} realData={state.realData} />
          {hasWork(state.plan, canWriteInternals, state.realData) ? (
            <Row title={t.oneCConfirm} tone="link" onClick={() => void run(state.plan, state.realData)} />
          ) : null}
          <Row title={t.cancel} tone="muted" onClick={() => setState({ kind: 'idle' })} />
        </>
      )}
      <input
        ref={input}
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        multiple
        hidden
        onChange={(e) => {
          const list = e.target.files;
          if (list?.length) void read(list);
          e.target.value = '';
        }}
      />
    </Section>
  );
}

const salesRows = (plan: ImportPlan) => plan.sales.reduce((n, s) => n + s.rows.length, 0);
const hasWork = (plan: ImportPlan, canWriteInternals: boolean, realData: boolean) =>
  plan.products.length > 0 || (canWriteInternals && (plan.internals.length > 0 || salesRows(plan) > 0
    || (realData && plan.supplierPrices.length > 0)));

function PlanSummary({ plan, canWriteInternals, realData }: { plan: ImportPlan; canWriteInternals: boolean; realData: boolean }) {
  const t = ru.catalog.import;
  const closed = plan.internals.length > 0 || salesRows(plan) > 0;
  return (
    <>
      <Row title={hasWork(plan, canWriteInternals, realData) ? t.oneCPlan(plan.stats.created, plan.stats.changed) : t.oneCNothing} tone="muted" />
      {canWriteInternals && plan.supplierPrices.length > 0 && (
        <Row title={realData ? t.oneCSupplierPrices(plan.supplierPrices.length) : t.oneCSuppliersBlocked} tone="muted" />
      )}
      {plan.internals.length > 0 && canWriteInternals && <Row title={t.oneCInternals(plan.internals.length)} tone="muted" />}
      {canWriteInternals && plan.sales.map((s) => (
        <Row key={`${s.from}:${s.to}`} title={t.oneCSales(formatPeriod(s.from, s.to), s.rows.length)} tone="muted" />
      ))}
      {closed && !canWriteInternals && <Row title={t.oneCOwnerOnly} tone="muted" />}
      {plan.stats.unmatched > 0 && <Row title={t.oneCUnmatched(plan.stats.unmatched)} tone="muted" />}
    </>
  );
}
