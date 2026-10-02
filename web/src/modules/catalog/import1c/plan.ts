// План загрузки выгрузок 1С (КАТ-5): что обновить, что создать, где закупка и остаток.
// Сопоставление как в старом каталоге: код → штрихкод → название → те же слова в другом порядке.
// Существующий товар не переименовывается, фото и описание не трогаются; пустое в файле ничего не стирает.
import type { CatalogProduct } from '../../../api/catalog';
import type { ImportGroup, ImportInternal, ImportProduct, ImportSale } from '../../../api/importCatalog';
import type { CatalogGroup } from '../search';
import {
  nameKey, norm, normCode, type BarcodeRec, type PriceItem, type RetailRec, type SalesPeriod, type SalesRec, type StockRec, type SupplierPrice,
} from './parse';

export type ParsedReport =
  | { type: 'prices'; items: PriceItem[] }
  | { type: 'barcodes'; recs: BarcodeRec[] }
  | { type: 'stock'; recs: StockRec[] }
  | { type: 'retail'; recs: RetailRec[] }
  | { type: 'sales'; recs: SalesRec[]; period: SalesPeriod };

/** Порядок загрузки: сначала товары и цены, потом штрихкоды, остатки и розница (как в старом каталоге); продажи — последними:
 *  они только ищут товары и ничего не создают. */
const ORDER: ParsedReport['type'][] = ['prices', 'barcodes', 'stock', 'retail', 'sales'];

export interface ImportPlan {
  groups: ImportGroup[];
  products: ImportProduct[];
  internals: ImportInternal[];
  /** Продажи по файлам: у каждого свой период; товары уже найдены в каталоге. */
  sales: (SalesPeriod & { rows: ImportSale[] })[];
  stats: { created: number; changed: number; unmatched: number; unmatchedNames: string[] };
}

interface Draft {
  id: string;
  isNew: boolean;
  original: CatalogProduct | null;
  cashCode: string | null;
  name: string;
  groupId: string | null;
  unit: 'pcs' | 'kg';
  weighted: boolean;
  retail: number | null;
  arrival: string | null;
  barcodes: Set<string>;
  purchase: number | null;
  stock: number | null;
}

/** Рубли из 1С → целые копейки. */
export const toKopecks = (rubles: number) => Math.round(rubles * 100);

const isPackUnit = (unit: string) => unit.includes('(') || /^(упак|упаковка|блок|кор)/.test(unit);

/** Сколько базовых единиц в упаковке — число в скобках единицы 1С: «упак (48)» → 48, «кг (2,5)» → 2,5. */
export function packQty(unit: string): number | null {
  const m = /\(\s*([\d\s]+(?:[.,]\d+)?)\s*\)\s*$/.exec(unit);
  if (!m?.[1]) return null;
  const n = Number(m[1].replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 1 ? n : null;
}

/** Закупка за базовую единицу (шт или кг): самая свежая цена среди поставщиков. Цена за упаковку делится на
 *  число в ней (как в старом каталоге), но только если цены за штуку нет: число в скобках — менее надёжный источник.
 *  Упаковка без числа пропускается — сколько в ней штук, неизвестно. */
export function pickPurchase(prices: readonly SupplierPrice[]): number | null {
  let best: SupplierPrice | null = null;
  let bestPack: { date: string | null; piece: number } | null = null;
  for (const p of prices) {
    if (p.unit && isPackUnit(p.unit)) {
      const qty = packQty(p.unit);
      if (qty !== null && (!bestPack || (p.date ?? '') > (bestPack.date ?? ''))) bestPack = { date: p.date, piece: p.price / qty };
      continue;
    }
    if (!best || (p.date ?? '') > (best.date ?? '')) best = p;
  }
  if (best) return toKopecks(best.price);
  return bestPack ? toKopecks(bestPack.piece) : null;
}

const newId = () => crypto.randomUUID();

export function buildImportPlan(
  reports: readonly ParsedReport[],
  catalog: readonly CatalogProduct[],
  groups: readonly CatalogGroup[],
): ImportPlan {
  const byCode = new Map<string, CatalogProduct>();
  const byBarcode = new Map<string, CatalogProduct>();
  const byName = new Map<string, CatalogProduct>();
  const byKey = new Map<string, CatalogProduct | null>();
  const byArticle = new Map<string, CatalogProduct>();
  for (const p of catalog) {
    if (p.cashCode) byCode.set(normCode(p.cashCode), p);
    for (const b of p.barcodes) byBarcode.set(b, p);
    byName.set(norm(p.name), p);
    if (p.article) byArticle.set(norm(p.article), p);
    const k = nameKey(p.name);
    // Ключ, подходящий двум товарам, ничего не доказывает — такой не используем.
    if (k) byKey.set(k, byKey.has(k) ? null : p);
  }

  const drafts = new Map<string, Draft>();
  const newByCode = new Map<string, Draft>();
  const newByName = new Map<string, Draft>();
  const draftOf = (p: CatalogProduct): Draft => {
    let d = drafts.get(p.id);
    if (!d) {
      d = {
        id: p.id, isNew: false, original: p, cashCode: p.cashCode, name: p.name, groupId: p.groupId, unit: p.unit,
        weighted: p.isWeighted, retail: p.retailPrice, arrival: p.arrivalOn, barcodes: new Set(p.barcodes), purchase: null, stock: null,
      };
      drafts.set(p.id, d);
    }
    return d;
  };
  const match = (code: string | null, barcodes: readonly string[], name: string | null): Draft | null => {
    const c = code ? normCode(code) : '';
    if (c) {
      const p = byCode.get(c);
      if (p) return draftOf(p);
      const d = newByCode.get(c);
      if (d) return d;
    }
    for (const b of barcodes) {
      const p = byBarcode.get(b);
      if (p) return draftOf(p);
    }
    if (name) {
      const p = byName.get(norm(name));
      if (p) return draftOf(p);
      const d = newByName.get(norm(name));
      if (d) return d;
      const k = nameKey(name);
      const pk = k ? byKey.get(k) : null;
      if (pk) return draftOf(pk);
    }
    return null;
  };
  const create = (name: string, code: string | null): Draft => {
    const d: Draft = {
      id: newId(), isNew: true, original: null, cashCode: code ? normCode(code) : null, name, groupId: null, unit: 'pcs',
      weighted: false, retail: null, arrival: null, barcodes: new Set(), purchase: null, stock: null,
    };
    drafts.set(d.id, d);
    if (d.cashCode) newByCode.set(d.cashCode, d);
    newByName.set(norm(name), d);
    return d;
  };

  const groupIds = new Map(groups.map((g) => [norm(g.name), g.id]));
  const newGroups: ImportGroup[] = [];
  const groupId = (name: string): string => {
    const key = norm(name);
    let id = groupIds.get(key);
    if (!id) {
      id = newId();
      groupIds.set(key, id);
      newGroups.push({ id, name: name.trim() });
    }
    return id;
  };

  const unmatched = new Set<string>();
  const addBarcodes = (d: Draft, codes: Iterable<string>) => {
    for (const b of codes) if (/^[0-9A-Za-z-]{1,64}$/.test(b)) d.barcodes.add(b);
  };
  const latest = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
  const sales: ImportPlan['sales'] = [];

  const sorted = [...reports].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
  for (const report of sorted) {
    if (report.type === 'prices') {
      for (const item of report.items) {
        const d = match(item.code, item.barcodes, item.name) ?? create(item.name, item.code);
        if (item.group) d.groupId = groupId(item.group);
        if (item.weighted) {
          d.unit = 'kg';
          d.weighted = true;
        }
        if (item.retail !== null) d.retail = toKopecks(item.retail);
        addBarcodes(d, item.barcodes);
        for (const p of item.prices) d.arrival = latest(d.arrival, p.date);
        const purchase = pickPurchase(item.prices);
        if (purchase !== null) d.purchase = purchase;
      }
    } else if (report.type === 'barcodes') {
      for (const rec of report.recs) {
        const d = match(rec.code, [rec.barcode], rec.name);
        if (d) addBarcodes(d, [rec.barcode]);
        else unmatched.add(rec.name);
      }
    } else if (report.type === 'stock') {
      for (const rec of report.recs) {
        const d = match(rec.code, rec.barcode ? [rec.barcode] : [], rec.name) ?? create(rec.name, rec.code);
        if (rec.barcode) addBarcodes(d, [rec.barcode]);
        if (rec.group) d.groupId = groupId(rec.group);
        if (rec.unit === 'кг') {
          d.unit = 'kg';
          d.weighted = true;
        }
        if (rec.retail !== null) d.retail = toKopecks(rec.retail);
        d.stock = rec.stock;
      }
    } else if (report.type === 'sales') {
      const rows = new Map<string, ImportSale>();
      for (const rec of report.recs) {
        const d = match(rec.code, [], rec.name);
        if (!d) {
          unmatched.add(rec.name);
          continue;
        }
        const row = rows.get(d.id) ?? { product_id: d.id, qty: 0, amount: null };
        row.qty = Math.round((row.qty + rec.qty) * 1000) / 1000;
        if (rec.amount !== null) row.amount = (row.amount ?? 0) + toKopecks(rec.amount);
        rows.set(d.id, row);
      }
      sales.push({ ...report.period, rows: [...rows.values()] });
    } else {
      for (const rec of report.recs) {
        const d = match(null, [], rec.name)
          ?? (rec.article ? (() => {
            const p = byArticle.get(norm(rec.article));
            return p ? draftOf(p) : null;
          })() : null);
        if (d) d.retail = toKopecks(rec.retail);
        else unmatched.add(rec.name);
      }
    }
  }

  const products: ImportProduct[] = [];
  const internals: ImportInternal[] = [];
  let created = 0;
  let changed = 0;
  for (const d of drafts.values()) {
    const o = d.original;
    const newBarcodes = o ? [...d.barcodes].filter((b) => !o.barcodes.includes(b)) : [...d.barcodes];
    const differs = !o || d.groupId !== o.groupId || d.unit !== o.unit || d.weighted !== o.isWeighted
      || d.retail !== o.retailPrice || d.arrival !== o.arrivalOn || newBarcodes.length > 0;
    if (differs) {
      if (o) changed++;
      else created++;
      products.push({
        id: d.id,
        cash_code: d.cashCode,
        name: d.name,
        group_id: d.groupId,
        unit: d.unit,
        is_weighted: d.weighted,
        retail_price: d.retail,
        in_stock: null,
        arrival_on: d.arrival,
        barcodes: newBarcodes,
      });
    }
    if (d.purchase !== null || d.stock !== null) internals.push({ product_id: d.id, purchase_price: d.purchase, stock: d.stock });
  }
  return {
    groups: newGroups,
    products,
    internals,
    sales,
    stats: { created, changed, unmatched: unmatched.size, unmatchedNames: [...unmatched].slice(0, 20) },
  };
}
