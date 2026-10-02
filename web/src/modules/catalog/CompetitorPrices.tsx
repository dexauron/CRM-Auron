// КАТ-6: цены других магазинов в карточке товара. Только своим: сервер отдаёт их владельцу, управляющему,
// бухгалтеру и сотрудникам зала; покупатель и гость этот раздел не получают даже прямым запросом.
import { Fragment, useEffect, useState } from 'react';
import type { CatalogProduct } from '../../api/catalog';
import {
  addCompetitor, addCompetitorPrice, deleteCompetitorPrice, latestByCompetitor, loadCompetitorPrices, loadCompetitors,
  sameName, verdict, type Competitor, type CompetitorPrice,
} from '../../api/competitors';
import { isoDay, todayIso } from '../../shared/date';
import { ru } from '../../shared/i18n/ru';
import { formatRub, parseRub } from '../../shared/money';
import { Icon } from '../../shared/ui/icons';
import { Row, Section } from '../../shared/ui/List';

export interface RivalAccess {
  orgId: string;
  viewerId: string | null;
  /** Владелец, управляющий, сотрудник зала: могут записать цену. */
  canWrite: boolean;
  /** Владелец и управляющий: удаляют любую запись; остальные — только свою. */
  canManage: boolean;
}

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; competitors: Competitor[]; prices: CompetitorPrice[] };
interface Draft {
  competitorId: string;
  name: string;
  price: string;
  date: string;
}
const NEW = 'new';
const byName = (a: Competitor, b: Competitor) => a.name.localeCompare(b.name, 'ru');

export function CompetitorPrices({ product, access }: { product: CatalogProduct; access: RivalAccess }) {
  const t = ru.catalog.card.rivals;
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([loadCompetitors(access.orgId), loadCompetitorPrices(product.id)]).then(
      ([competitors, prices]) => active && setLoad({ kind: 'ready', competitors, prices }),
      () => active && setLoad({ kind: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [access.orgId, product.id, attempt]);

  if (load.kind !== 'ready') {
    return (
      <Section title={t.title} id="rivals-title">
        {load.kind === 'loading' ? (
          <Row leading={<span className="spinner" />} title={t.loading} tone="muted" />
        ) : (
          <div role="alert">
            <Row title={t.error} tone="bad" onClick={() => { setLoad({ kind: 'loading' }); setAttempt((n) => n + 1); }} />
          </div>
        )}
      </Section>
    );
  }

  const { competitors, prices } = load;
  const names = new Map(competitors.map((c) => [c.id, c.name]));
  const nameOf = (id: string) => names.get(id) ?? '—';
  const latest = latestByCompetitor(prices);
  const summary = verdict(product.retailPrice, latest);
  const ours = product.retailPrice;
  const canDelete = (p: CompetitorPrice) =>
    access.canManage || (access.canWrite && access.viewerId !== null && p.createdBy === access.viewerId);

  const open = () => {
    setProblem(null);
    setConfirm(null);
    setDraft({ competitorId: competitors[0]?.id ?? NEW, name: '', price: '', date: todayIso() });
  };

  const save = async (d: Draft) => {
    const price = parseRub(d.price);
    if (price === null || price <= 0) return setProblem(t.invalidPrice);
    if (d.competitorId === NEW && !d.name.trim()) return setProblem(t.invalidName);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || d.date > todayIso()) return setProblem(t.invalidDate);
    setBusy(true);
    setProblem(null);
    try {
      const competitor = competitors.find((c) => c.id === d.competitorId)
        ?? competitors.find((c) => sameName(c.name, d.name))
        ?? (await addCompetitor(access.orgId, d.name));
      const added = await addCompetitorPrice(access.orgId, product.id, competitor.id, price, d.date);
      const list = competitors.some((c) => c.id === competitor.id) ? competitors : [...competitors, competitor].sort(byName);
      setLoad({ kind: 'ready', competitors: list, prices: [added, ...prices] });
      setDraft(null);
    } catch {
      setProblem(t.saveError);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    setBusy(true);
    setProblem(null);
    try {
      await deleteCompetitorPrice(id);
      setLoad({ kind: 'ready', competitors, prices: prices.filter((p) => p.id !== id) });
      setConfirm(null);
    } catch {
      setProblem(t.deleteError);
    } finally {
      setBusy(false);
    }
  };

  const diff = (price: number) => {
    if (ours === null || ours <= 0) return null;
    if (price < ours) return t.cheaperBy(formatRub(ours - price));
    if (price > ours) return t.dearerBy(formatRub(price - ours));
    return t.samePrice;
  };

  return (
    <>
      <Section title={t.title} id="rivals-title" footer={t.footer}>
        {summary.kind !== 'none' && (
          <Row
            title={summary.kind === 'cheapest' ? t.cheapest(formatRub(summary.by), nameOf(summary.rival.competitorId))
              : summary.kind === 'same' ? t.same(nameOf(summary.rival.competitorId))
                : t.cheaperThere(nameOf(summary.rival.competitorId), formatRub(summary.rival.price), formatRub(summary.by))}
            subtitle={t.compared(latest.length)}
            tone={summary.kind === 'cheapest' ? 'good' : summary.kind === 'cheaper_there' ? 'bad' : 'default'}
          />
        )}
        {latest.length === 0 && <Row title={t.empty} tone="muted" />}
        {latest.map((p) => (
          <Fragment key={p.id}>
            <Row
              title={nameOf(p.competitorId)}
              subtitle={[isoDay(p.observedOn), diff(p.price)].filter(Boolean).join(' · ')}
              trailing={<span className="price">{formatRub(p.price)}</span>}
              {...(canDelete(p) && !busy ? { onClick: () => setConfirm(confirm === p.id ? null : p.id) } : {})}
            />
            {confirm === p.id && (
              <>
                <Row title={t.deleteAsk(nameOf(p.competitorId), isoDay(p.observedOn))} tone="bad" disabled={busy}
                  onClick={() => void remove(p.id)} />
                <Row title={t.cancel} tone="muted" onClick={() => setConfirm(null)} />
              </>
            )}
          </Fragment>
        ))}
        {access.canWrite && !draft && <Row title={t.add} tone="link" onClick={open} />}
        {problem && !draft && <div role="alert"><Row title={problem} tone="bad" /></div>}
      </Section>

      {draft && (
        <Section title={t.formTitle} id="rival-form-title" footer={t.formFooter}>
          <label className="row row-inset-text row-select">
            <span className="row-main"><span className="row-title">{t.store}</span></span>
            <span className="row-trailing">
              {draft.competitorId === NEW ? t.newStore : nameOf(draft.competitorId)}
              <Icon name="chevronUpDown" className="row-chevron" />
            </span>
            <select aria-label={t.store} value={draft.competitorId} onChange={(e) => setDraft({ ...draft, competitorId: e.target.value })}>
              {competitors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value={NEW}>{t.newStore}</option>
            </select>
          </label>
          {draft.competitorId === NEW && (
            <label className="row row-inset-text row-field">
              <span className="row-title">{t.storeName}</span>
              <input value={draft.name} maxLength={80} placeholder={t.storePlaceholder} autoComplete="off"
                onChange={(e) => { setProblem(null); setDraft({ ...draft, name: e.target.value }); }} />
            </label>
          )}
          <label className="row row-inset-text row-field">
            <span className="row-title">{t.price}</span>
            <input value={draft.price} inputMode="decimal" placeholder={t.pricePlaceholder} autoComplete="off"
              onChange={(e) => { setProblem(null); setDraft({ ...draft, price: e.target.value }); }} />
          </label>
          <label className="row row-inset-text row-field">
            <span className="row-title">{t.date}</span>
            <input type="date" value={draft.date} max={todayIso()} onChange={(e) => { setProblem(null); setDraft({ ...draft, date: e.target.value }); }} />
          </label>
          {problem && <div role="alert"><Row title={problem} tone="bad" /></div>}
          <Row title={busy ? t.saving : t.save} tone="link" center disabled={busy} onClick={() => void save(draft)} />
          <Row title={t.cancel} tone="muted" center disabled={busy} onClick={() => { setDraft(null); setProblem(null); }} />
        </Section>
      )}
    </>
  );
}
