// Этап 2, ПСТ-1: справочник поставщиков — список с поиском, карточка с контактами (звонок и WhatsApp одним
// нажатием), правка для владельца и управляющего, загрузка «Контрагентов» из 1С там, где разрешены настоящие данные.
import { Fragment, useEffect, useRef, useState } from 'react';
import {
  createContact, createSupplier, deleteContact, importSupplierContacts, loadSuppliers, matchSupplier, realDataAllowed,
  SuppliersError, updateContact, updateSupplier, whatsappUrl, type ContactImportRow, type Supplier, type SupplierContact,
} from '../../api/suppliers';
import { ru } from '../../shared/i18n/ru';
import { formatPhone } from '../../shared/phone';
import { Icon } from '../../shared/ui/icons';
import { LargeTitle } from '../../shared/ui/LargeTitle';
import { Row, RowAction, Section } from '../../shared/ui/List';
import { keepAwake } from '../../shared/wakeLock';
import { readRows } from '../catalog/import1c/read';
import { parseContactsReport, type ContactRec } from './contacts1c';
import { ContactForm, SupplierForm, type SaveError } from './SupplierForms';
import { OrderCard, OrdersList } from './Orders';

const t = ru.suppliers;

export interface SupplierOrg {
  orgId: string;
  orgName: string;
  /** Владелец или управляющий: правит справочник и загружает контакты. */
  canEdit: boolean;
}

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; suppliers: Supplier[]; realData: boolean };

const saveError = (error: unknown): SaveError =>
  error instanceof SuppliersError && error.reason === 'duplicate' ? 'duplicate'
    : error instanceof SuppliersError && error.reason === 'forbidden' ? 'forbidden' : 'failed';

function summary(s: Supplier): string {
  const agents = s.contacts.filter((c) => c.name).slice(0, 2).map((c) => c.name);
  const phone = s.contacts.find((c) => c.phone)?.phone;
  return [s.kind && t.kinds[s.kind], ...agents, phone && formatPhone(phone)].filter(Boolean).join(' · ');
}

export function SuppliersScreen({
  orgs, supplierId, orders, orderId, accountLoading, onOpen, onOpenOrders, onOpenOrder, onBack,
}: {
  orgs: readonly SupplierOrg[];
  supplierId: string | null;
  /** Открыты заказы поставщикам (ПСТ-2), а не справочник. */
  orders: boolean;
  orderId: string | null;
  accountLoading: boolean;
  onOpen: (id: string) => void;
  onOpenOrders: () => void;
  onOpenOrder: (id: string) => void;
  onBack: () => void;
}) {
  const org = orgs[0] ?? null;
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!org) return;
    let active = true;
    Promise.all([loadSuppliers(org.orgId), realDataAllowed()]).then(
      ([suppliers, realData]) => active && setLoad({ kind: 'ready', suppliers, realData }),
      () => active && setLoad({ kind: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [org, attempt]);

  const replace = (next: Supplier) =>
    setLoad((prev) => (prev.kind === 'ready'
      ? { ...prev, suppliers: [...prev.suppliers.filter((s) => s.id !== next.id), next].sort((a, b) => a.name.localeCompare(b.name, 'ru')) }
      : prev));

  const supplier = load.kind === 'ready' && supplierId ? load.suppliers.find((s) => s.id === supplierId) ?? null : null;
  const header = orderId
    ? <LargeTitle title={t.orders.cardTitle} back={{ label: t.orders.title, onClick: onBack }} />
    : orders
      ? <LargeTitle title={t.orders.title} back={{ label: t.title, onClick: onBack }} />
      : supplierId
        ? <LargeTitle title={supplier?.name ?? t.title} back={{ label: t.title, onClick: onBack }} />
        : <LargeTitle title={t.title} back={{ label: ru.appName, onClick: onBack }} />;

  if (!org) {
    return (
      <>
        {header}
        <main>
          {accountLoading ? (
            <Section><Row leading={<span className="spinner" />} title={t.loading} tone="muted" /></Section>
          ) : (
            <Section footer={t.noAccessFooter}><Row title={t.noAccess} tone="muted" /></Section>
          )}
        </main>
      </>
    );
  }

  if (orders) {
    return (
      <>
        {header}
        <main>
          {orderId
            ? <OrderCard orgId={org.orgId} orderId={orderId} canManage={org.canEdit} />
            : <OrdersList orgId={org.orgId} onOpenOrder={onOpenOrder} />}
        </main>
      </>
    );
  }

  if (load.kind !== 'ready') {
    return (
      <>
        {header}
        <main>
          <Section>
            {load.kind === 'loading' ? (
              <Row leading={<span className="spinner" />} title={t.loading} tone="muted" />
            ) : (
              <div role="alert">
                <Row title={t.error} tone="bad" onClick={() => { setLoad({ kind: 'loading' }); setAttempt((n) => n + 1); }} />
              </div>
            )}
          </Section>
        </main>
      </>
    );
  }

  return (
    <>
      {header}
      <main>
        {!load.realData && (
          <p className="notice tone-warn" role="status">
            <Icon name="warning" />
            {t.testServer}
          </p>
        )}
        {supplierId ? (
          supplier && !supplier.deleted ? (
            <SupplierCard key={supplier.id} org={org} supplier={supplier} onChange={replace} onDeleted={(s) => { replace(s); onBack(); }} />
          ) : (
            <Section><Row title={t.notFoundCard} tone="muted" /></Section>
          )
        ) : (
          <SupplierList org={org} suppliers={load.suppliers} realData={load.realData} onOpen={onOpen}
            onOpenOrders={onOpenOrders} onChange={replace}
            onImported={() => void loadSuppliers(org.orgId).then(
              (suppliers) => setLoad((prev) => (prev.kind === 'ready' ? { ...prev, suppliers } : prev)),
              () => undefined,
            )} />
        )}
      </main>
    </>
  );
}

function SupplierList({ org, suppliers, realData, onOpen, onOpenOrders, onChange, onImported }: {
  org: SupplierOrg;
  suppliers: Supplier[];
  realData: boolean;
  onOpen: (id: string) => void;
  onOpenOrders: () => void;
  onChange: (s: Supplier) => void;
  onImported: () => void;
}) {
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const active = suppliers.filter((s) => !s.deleted);
  const deleted = suppliers.filter((s) => s.deleted);
  const found = active.filter((s) => matchSupplier(s, query));

  return (
    <>
      <label className="search-field">
        <Icon name="search" />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.searchPlaceholder}
          aria-label={t.searchLabel} enterKeyHint="search" autoComplete="off" />
        {query && (
          <button type="button" className="search-clear" aria-label={ru.catalog.clear} onClick={() => setQuery('')}>
            <Icon name="clear" />
          </button>
        )}
      </label>

      <Section>
        <Row leading={<Icon name="truck" className="row-icon" />} title={t.orders.entry} subtitle={t.orders.entryHint}
          chevron onClick={onOpenOrders} />
      </Section>

      <Section footer={active.length ? t.count(active.length) : undefined}>
        {found.length === 0 && <Row title={active.length ? t.notFound : t.empty} tone="muted" />}
        {found.map((s) => {
          const sub = summary(s);
          return <Row key={s.id} title={s.name} {...(sub ? { subtitle: sub } : {})} chevron onClick={() => onOpen(s.id)} />;
        })}
      </Section>

      {org.canEdit && (adding ? (
        <SupplierForm title={t.form.newSupplier} initial={null} onCancel={() => setAdding(false)} onSave={async (draft) => {
          try {
            const created = await createSupplier(org.orgId, draft);
            onChange(created);
            setAdding(false);
            onOpen(created.id);
            return null;
          } catch (error) {
            return saveError(error);
          }
        }} />
      ) : (
        <Section>
          <Row leading={<Icon name="plus" className="row-icon" />} title={t.add} tone="link" onClick={() => setAdding(true)} />
        </Section>
      ))}

      {org.canEdit && <ContactsImport orgId={org.orgId} realData={realData} onImported={onImported} />}

      {org.canEdit && deleted.length > 0 && (
        <Section title={t.trash} id="suppliers-trash" footer={t.trashFooter}>
          {deleted.map((s) => (
            <Row key={s.id} title={s.name} tone="muted" trailing={
              <RowAction onClick={() => void updateSupplier(s.id, { deleted_at: null }).then(onChange, () => undefined)}>{t.restore}</RowAction>
            } />
          ))}
        </Section>
      )}
    </>
  );
}

function ContactRow({ contact, onEdit }: { contact: SupplierContact; onEdit: (() => void) | null }) {
  const title = contact.name ?? t.roles[contact.role];
  const subtitle = [contact.name ? t.roles[contact.role] : null, contact.phone && formatPhone(contact.phone),
    contact.brands && t.brands(contact.brands)].filter(Boolean).join(' · ');
  const main = (
    <>
      <span className="row-title">{title}</span>
      {subtitle && <span className="row-subtitle">{subtitle}</span>}
    </>
  );
  return (
    <div className="row row-inset-text contact-row">
      {onEdit ? <button type="button" className="row-main contact-edit" onClick={onEdit}>{main}</button> : <span className="row-main">{main}</span>}
      {contact.phone && (
        <span className="row-trailing">
          <a className="icon-button" href={`tel:${contact.phone}`} aria-label={`${t.call}: ${title}`}><Icon name="phone" /></a>
          <a className="icon-button" href={whatsappUrl(contact.phone)} target="_blank" rel="noopener noreferrer"
            aria-label={`${t.whatsapp}: ${title}`}><Icon name="message" /></a>
        </span>
      )}
    </div>
  );
}

function SupplierCard({ org, supplier, onChange, onDeleted }: {
  org: SupplierOrg;
  supplier: Supplier;
  onChange: (s: Supplier) => void;
  onDeleted: (s: Supplier) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState<SupplierContact | 'new' | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const withContacts = (contacts: SupplierContact[]) => onChange({ ...supplier, contacts });

  return (
    <>
      {editing ? (
        <SupplierForm title={t.form.supplier} initial={supplier} onCancel={() => setEditing(false)} onSave={async (draft) => {
          try {
            onChange(await updateSupplier(supplier.id, draft));
            setEditing(false);
            return null;
          } catch (error) {
            return saveError(error);
          }
        }} />
      ) : (
        <Section title={t.details} id="supplier-details">
          <Row title={t.kind} fact trailing={<span className="row-detail tone-muted">{supplier.kind ? t.kinds[supplier.kind] : t.noKind}</span>} />
          {supplier.note && <Row title={t.note} subtitle={supplier.note} />}
          {org.canEdit && <Row title={t.edit} tone="link" onClick={() => setEditing(true)} />}
        </Section>
      )}

      <Section title={t.contacts} id="supplier-contacts">
        {supplier.contacts.length === 0 && <Row title={t.noContacts} tone="muted" />}
        {supplier.contacts.map((c) => (
          <Fragment key={c.id}>
            <ContactRow contact={c} onEdit={org.canEdit ? () => setContact(c) : null} />
          </Fragment>
        ))}
        {org.canEdit && contact === null && (
          <Row leading={<Icon name="plus" className="row-icon" />} title={t.addContact} tone="link" onClick={() => setContact('new')} />
        )}
      </Section>

      {contact && (
        <ContactForm
          key={contact === 'new' ? 'new' : contact.id}
          initial={contact === 'new' ? null : contact}
          onCancel={() => setContact(null)}
          onSave={async (draft) => {
            try {
              if (contact === 'new') {
                withContacts([...supplier.contacts, await createContact(org.orgId, supplier.id, draft)]);
              } else {
                const saved = await updateContact(contact.id, draft);
                withContacts(supplier.contacts.map((c) => (c.id === saved.id ? saved : c)));
              }
              setContact(null);
              return null;
            } catch (error) {
              return saveError(error);
            }
          }}
          {...(contact === 'new' ? {} : {
            onDelete: async () => {
              try {
                await deleteContact(contact.id);
                withContacts(supplier.contacts.filter((c) => c.id !== contact.id));
                setContact(null);
                return null;
              } catch (error) {
                return saveError(error);
              }
            },
          })}
        />
      )}

      {org.canEdit && (
        <Section {...(confirm ? { footer: t.removeAsk } : {})}>
          {confirm ? (
            <>
              <Row title={t.removeConfirm} tone="bad" center onClick={() => {
                void updateSupplier(supplier.id, { deleted_at: new Date().toISOString() }).then(onDeleted, () => setProblem(t.errors.failed));
              }} />
              <Row title={t.cancel} tone="muted" center onClick={() => setConfirm(false)} />
            </>
          ) : (
            <Row title={t.remove} tone="bad" center onClick={() => setConfirm(true)} />
          )}
          {problem && <div role="alert"><Row title={problem} tone="bad" /></div>}
        </Section>
      )}
    </>
  );
}

type ImportState =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'confirm'; recs: ContactRec[] }
  | { kind: 'running'; text: string }
  | { kind: 'done'; text: string }
  | { kind: 'error'; text: string };

function ContactsImport({ orgId, realData, onImported }: { orgId: string; realData: boolean; onImported: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ImportState>({ kind: 'idle' });
  const i = t.import;

  const read = async (file: File) => {
    setState({ kind: 'reading' });
    try {
      setState({ kind: 'confirm', recs: parseContactsReport(await readRows(file)) });
    } catch {
      setState({ kind: 'error', text: i.wrongFile });
    }
  };

  const run = async (recs: ContactRec[]) => {
    const rows: ContactImportRow[] = recs.map((r) => ({ name: r.name, phones: r.phones }));
    const release = await keepAwake();
    try {
      setState({ kind: 'running', text: i.progress(0, rows.length) });
      const totals = await importSupplierContacts(orgId, rows, (done, total) => setState({ kind: 'running', text: i.progress(done, total) }));
      setState({ kind: 'done', text: i.done(totals.suppliers, totals.contacts) });
      onImported();
    } catch (error) {
      setState({ kind: 'error', text: error instanceof SuppliersError && error.reason === 'real_data' ? i.realData : i.failed });
    } finally {
      release();
    }
  };

  const bad = state.kind === 'confirm' ? state.recs.flatMap((r) => r.bad.map((b) => `${r.name}: ${b}`)) : [];
  return (
    <Section title={i.title} id="contacts-import" footer={i.footer}>
      {state.kind === 'idle' && (
        <Row title={i.choose} tone={realData ? 'link' : 'muted'} disabled={!realData}
          {...(realData ? {} : { subtitle: i.blocked })} onClick={() => input.current?.click()} />
      )}
      {(state.kind === 'reading' || state.kind === 'running') && (
        <div role="status"><Row leading={<span className="spinner" />} title={state.kind === 'reading' ? i.reading : state.text} tone="muted" /></div>
      )}
      {state.kind === 'done' && <div role="status"><Row title={state.text} tone="good" onClick={() => setState({ kind: 'idle' })} /></div>}
      {state.kind === 'error' && <div role="alert"><Row title={state.text} tone="bad" onClick={() => setState({ kind: 'idle' })} /></div>}
      {state.kind === 'confirm' && (
        <>
          <Row title={i.plan(state.recs.length, state.recs.reduce((n, r) => n + r.phones.length, 0))} tone="muted" />
          {bad.length > 0 && <Row title={i.bad(bad.length)} subtitle={bad.slice(0, 20).join('; ')} tone="muted" />}
          <Row title={i.confirm} tone="link" onClick={() => void run(state.recs)} />
          <Row title={t.cancel} tone="muted" onClick={() => setState({ kind: 'idle' })} />
        </>
      )}
      <input ref={input} type="file" hidden
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void read(file);
          e.target.value = '';
        }} />
    </Section>
  );
}
