// Разбор отчётов 1С (КАТ-5). Перенос проверенной логики старого каталога WayMarket
// (catalog/js/modules/imports.js): тип отчёта узнаётся по шапке, колонки — по заголовкам,
// числа — в любой записи 1С («1 234,56», «1,234.56», остаток «2,500» = 2,5).
// Только разбор строк таблицы: ни сети, ни базы — всё проверяется тестами.

export type Rows = readonly (readonly unknown[])[];

export type ReportType = 'prices' | 'barcodes' | 'stock' | 'retail' | 'sales' | 'contacts' | 'units' | 'photo' | 'stale';
/** Что умеем загружать сейчас; остальные отчёты узнаём, но откладываем до своих модулей. */
export const SUPPORTED: readonly ReportType[] = ['prices', 'barcodes', 'stock', 'retail', 'sales'];

export function cellStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(Math.round(v));
  return String(v).trim();
}

export const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').trim();

/** Код номенклатуры: «1 463», «1 463» (неразрывный пробел), «1,463» → «1463». */
export function normCode(v: unknown): string {
  const s = String(v ?? '').replace(/[\s\u00a0]/g, '');
  return /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s;
}

const UNIT_FIX: [RegExp, string][] = [
  [/(\d+)\s*(?:грамм|гр|г)(?![а-яё])/g, '$1г'],
  [/(\d+)\s*(?:килограмм|кг)(?![а-яё])/g, '$1кг'],
  [/(\d+)\s*(?:миллилитр|мл)(?![а-яё])/g, '$1мл'],
  [/(\d+)\s*(?:литр|л)(?![а-яё])/g, '$1л'],
  [/(\d+)\s*(?:штук|шт)(?![а-яё])/g, '$1шт'],
];

/** Ключ названия: те же слова в любом порядке и единая запись единиц («200гр» = «200г»). */
export function nameKey(name: string): string {
  let s = norm(name);
  if (!s) return '';
  for (const [re, to] of UNIT_FIX) s = s.replace(re, to);
  return s.replace(/[^0-9a-zа-я%]+/g, ' ').split(' ').filter(Boolean).sort().join(' ');
}

/** Деньги из ячейки 1С в рублях: «1 234,56», «1,234.56», «96,76», «1,234» (тысячи). Не положительное — null. */
export function parsePriceNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v > 0 ? v : null;
  let s = String(v).replace(/\s/g, '');
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    const [whole = '', frac = '', ...rest] = s.split(',');
    s = rest.length === 0 && frac.length === 3 && /^\d+$/.test(whole) && Number(whole) !== 0 ? s.replace(',', '') : s.replace(',', '.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Количество и остаток: запятая всегда десятичная («2,500» = 2,5), минус допустим. */
export function parseCountNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  let s = String(v).replace(/[\s\u00a0]/g, '');
  const negative = s.startsWith('-');
  s = s.replace(/^[-+]/, '');
  s = s.includes(',') && s.includes('.') ? s.replace(/,/g, '') : s.replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

/** Дата из ячейки: серийный номер Excel или «01.07.2026» / «2026-07-01». */
export function parseDateCell(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  }
  const s = String(v);
  const m = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(s);
  if (m?.[1] && m[2] && m[3]) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return /\d{4}-\d{2}-\d{2}/.exec(s)?.[0] ?? null;
}

const RU_MONTHS = ['январ', 'феврал', 'март', 'апрел', 'мая', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];

/** Дата из шапки отчёта: «17.07.2026» или «17 июля 2026 г.». */
export function parseHeaderDate(rows: Rows): string | null {
  for (const row of rows.slice(0, 8)) {
    const line = row.map(cellStr).join(' ');
    const iso = parseDateCell(line);
    if (iso) return iso;
    const m = /(\d{1,2})\s+([а-яё]+)\s+(\d{4})/.exec(line.toLowerCase());
    if (m?.[1] && m[2] && m[3]) {
      const month = RU_MONTHS.findIndex((w) => m[2]?.startsWith(w));
      if (month >= 0) return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
  }
  return null;
}

interface Columns {
  name?: number;
  code?: number;
  article?: number;
  descr?: number;
  barcode?: number;
  supplier?: number;
  unit?: number;
  retail?: number;
  price?: number;
  qty?: number;
  amount?: number;
  date?: number;
  group?: number;
}

/** Строка заголовков и номера колонок; двухстрочная шапка («Номенклатура.Код») учитывается. */
export function detectColumns(rows: Rows): { cols: Columns; dataStart: number } | null {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const labels = (rows[r] ?? []).map((v) => cellStr(v).toLowerCase());
    const next = (rows[r + 1] ?? []).map((v) => cellStr(v).toLowerCase());
    if (!labels.some((l) => l.includes('номенклатура') || l.includes('наименование'))) continue;
    const cols: Columns = {};
    const width = Math.max(labels.length, next.length);
    for (let c = 0; c < width; c++) {
      const l = `${labels[c] ?? ''} ${next[c] ?? ''}`;
      if (!l.trim()) continue;
      if (l.includes('артикул')) cols.article ??= c;
      else if (l.includes('описание') || l.includes('характеристик')) cols.descr ??= c;
      else if (l.includes('штрих')) cols.barcode ??= c;
      else if (l.includes('код товара') || l.includes('номенклатура.код')) cols.code = c;
      else if (l.includes('код') && cols.code === undefined) cols.code = c;
      else if (l.includes('контрагент') || l.includes('поставщик')) cols.supplier ??= c;
      else if (l.includes('единиц') || /(^|\s)ед\.?(\s|$)/.test(l)) cols.unit ??= c;
      else if (l.includes('розничн') || l.includes('продажн') || l.includes('цена продаж')) cols.retail ??= c;
      else if (l.includes('цена')) cols.price ??= c;
      else if (l.includes('количество') || /(^|\s)кол-?во(\s|$)/.test(l)) cols.qty ??= c;
      else if ((l.includes('сумма продаж') || l.includes('выручка')) && !/приход|ндс|скидк|закуп|себестоим/.test(l)) cols.amount = c;
      else if (l.includes('сумма') && cols.amount === undefined && !/приход|ндс|скидк|закуп|себестоим|дополнит/.test(l)) cols.amount = c;
      else if (l.includes('дата') || l.includes('период')) cols.date ??= c;
      else if (l.includes('групп')) cols.group ??= c;
      else if ((l.includes('номенклатура') || l.includes('наименование')) && cols.name === undefined) cols.name = c;
    }
    if (cols.name === undefined) continue;
    const subheader = next.some((l) => l.includes('номенклатура.'));
    return { cols, dataStart: r + (subheader ? 2 : 1) };
  }
  return null;
}

/** Тип отчёта по шапке — порядок проверок тот же, что в старом каталоге (каждая строка — найденный случай). */
export function detectReportType(rows: Rows): ReportType | null {
  const scan = rows.slice(0, 32);
  const head = scan.map((r) => r.map(cellStr).join('\t')).join('\n').toLowerCase();
  const has = (s: string) => head.includes(s);
  const cellExact = (val: string) => scan.some((r) => r.some((c) => cellStr(c).toLowerCase() === val));
  const hasPrice = /цена/.test(head);
  const headNoService = head.replace(/выводить количество[^\n]*/g, '');
  const hasQty = headNoService.includes('количество') || /кол-?во/.test(headNoService);
  const hasStock = has('остаток') || has('остатк') || has('на конец дня');
  const hasContragent = cellExact('контрагент');
  const hasSupplier = has('поставщик') || hasContragent;

  if (/https?:\/\//.test(head)) return 'photo';
  if (/имя объекта:\s*единиц/.test(head)) return 'units';
  if (/коэффициент/.test(head) && !/коэффициент цены/.test(head) && /единиц/.test(head)) return 'units';
  if (/имя объекта:\s*штрих/.test(head)) return 'barcodes';
  const det = detectColumns(rows);
  if (det && det.cols.barcode !== undefined && det.cols.price === undefined && det.cols.retail === undefined
    && det.cols.qty === undefined && det.cols.amount === undefined) return 'barcodes';
  if (hasContragent && has('телефон')) return 'contacts';
  if (has('дата последнего поступления')) return 'stale';
  if (has('период') && hasQty && !hasStock) return 'sales';
  if (hasStock || (has('розничная цена') && hasQty)) return 'stock';
  if (has('прайс-лист') || has('прайслист') || has('тип цен')) return 'retail';
  if (hasSupplier && hasPrice) return 'prices';
  if (has('штрих') && !hasPrice && !hasQty) return 'barcodes';
  if ((has('номенклатура') || has('наименование')) && hasPrice) return 'retail';
  return null;
}

const TOTAL = /^\s*(итого|всего)/i;

/** Цена поставщика: строка прайса (рубли), единица строки и дата поступления. */
export interface SupplierPrice {
  supplier: string;
  price: number;
  unit: string | null;
  date: string | null;
}

export interface PriceItem {
  name: string;
  code: string | null;
  article: string | null;
  group: string | null;
  barcodes: string[];
  unit: string | null;
  weighted: boolean;
  retail: number | null;
  /** Самая свежая цена у каждого поставщика за каждую единицу (штука и упаковка — разные цены). */
  prices: SupplierPrice[];
}

/** «Цены поставщиков»: товары, штрихкоды, группы, закупка по поставщикам, иногда розница. */
export function parsePriceReport(rows: Rows): PriceItem[] {
  const det = detectColumns(rows);
  if (!det) throw new Error('Не нашёл строку заголовков (Номенклатура, Код товара…)');
  const { cols, dataStart } = det;
  const at = (row: readonly unknown[], c: number | undefined) => (c === undefined ? '' : cellStr(row[c]));
  const items = new Map<string, PriceItem & { bySupplier: Map<string, SupplierPrice> }>();
  for (const row of rows.slice(dataStart)) {
    const name = at(row, cols.name);
    if (!name || TOTAL.test(name)) continue;
    const code = cols.code === undefined ? '' : normCode(row[cols.code]);
    const key = code || norm(name);
    let item = items.get(key);
    if (!item) {
      item = { name, code: code || null, article: null, group: null, barcodes: [], unit: null, weighted: false, retail: null, prices: [], bySupplier: new Map() };
      items.set(key, item);
    }
    const unit = at(row, cols.unit).toLowerCase();
    const supplier = at(row, cols.supplier);
    const barcode = at(row, cols.barcode);
    const price = cols.price === undefined ? null : parsePriceNum(row[cols.price]);
    const retail = cols.retail === undefined ? null : parsePriceNum(row[cols.retail]);
    const date = cols.date === undefined ? null : parseDateCell(row[cols.date]);
    item.article ??= at(row, cols.article) || null;
    item.group ??= at(row, cols.group) || null;
    if (retail !== null) item.retail ??= retail;
    if (barcode && !item.barcodes.includes(barcode)) item.barcodes.push(barcode);
    if (unit) item.unit ??= unit;
    if (unit === 'кг') item.weighted = true;
    if (supplier && price !== null) {
      const key = `${supplier}\u0000${unit}`;
      const prev = item.bySupplier.get(key);
      if (!prev || (date ?? '') >= (prev.date ?? '')) item.bySupplier.set(key, { supplier, price, unit: unit || null, date });
    }
  }
  return [...items.values()].map(({ bySupplier, ...item }) => ({ ...item, prices: [...bySupplier.values()] }));
}

export interface BarcodeRec {
  barcode: string;
  name: string;
  code: string | null;
  unit: string;
}

/** Справочник «Штрих коды»: штрихкод, единица (шт, упак (24)…), номенклатура и код, если есть. */
export function parseBarcodesReport(rows: Rows): BarcodeRec[] {
  const det = detectColumns(rows);
  if (!det || det.cols.barcode === undefined) throw new Error('Не нашёл колонки «Штрих код» и «Номенклатура»');
  const { cols, dataStart } = det;
  const barcodeCol = det.cols.barcode;
  const recs: BarcodeRec[] = [];
  for (const row of rows.slice(dataStart)) {
    const barcode = cellStr(row[barcodeCol]).replace(/\s/g, '');
    const name = cols.name === undefined ? '' : cellStr(row[cols.name]);
    if (!barcode || !name || TOTAL.test(name)) continue;
    recs.push({
      barcode,
      name,
      code: cols.code === undefined ? null : normCode(row[cols.code]) || null,
      unit: cols.unit === undefined ? '' : cellStr(row[cols.unit]),
    });
  }
  if (!recs.length) throw new Error('В справочнике штрихкодов нет ни одной строки с кодом и номенклатурой');
  return recs;
}

export interface StockRec {
  name: string;
  code: string | null;
  barcode: string | null;
  group: string;
  unit: string;
  stock: number;
  retail: number | null;
}

/** «Остатки номенклатуры»: количество на складе и розничная цена; дата — из шапки («на конец дня: 12.08.2026»). */
export function parseStockReport(rows: Rows): { recs: StockRec[]; stockAt: string | null } {
  const cols: Columns & { stock?: number } = {};
  let stockAt: string | null = null;
  // Шапка бывает в несколько строк; данные — после последней строки, где нашлась колонка.
  let headerEnd = -1;
  rows.slice(0, 16).forEach((row, r) => {
    const found = Object.keys(cols).length;
    row.forEach((cell, c) => {
      const l = cellStr(cell).toLowerCase();
      if (!l) return;
      if (cols.name === undefined && (l === 'номенклатура' || l === 'наименование' || l === 'название')) cols.name = c;
      else if (cols.code === undefined && (l.includes('код товара') || l === 'номенклатура.код')) cols.code = c;
      else if (cols.barcode === undefined && (l.includes('штрихкод') || l.includes('штрих-код'))) cols.barcode = c;
      else if (cols.group === undefined && (l.includes('группа товара') || l.includes('входит в группу'))) cols.group = c;
      else if (cols.unit === undefined && l.includes('базовая единица')) cols.unit = c;
      else if (cols.stock === undefined && l === 'количество') cols.stock = c;
      else if (cols.retail === undefined && l.includes('розничная цена')) cols.retail = c;
    });
    if (Object.keys(cols).length > found) headerEnd = r;
    const line = row.map(cellStr).join(' ');
    const m = /на конец дня:?\s*(\d{1,2}\.\d{1,2}\.\d{2,4})/i.exec(line) ?? /на дату:?\s*(\d{1,2}\.\d{1,2}\.\d{2,4})/i.exec(line);
    if (m?.[1] && !stockAt) stockAt = parseDateCell(m[1]);
  });
  if (cols.name === undefined) throw new Error('Не нашёл колонку «Номенклатура» в отчёте «Остатки»');
  if (cols.stock === undefined) throw new Error('Не нашёл колонку «Количество» — нужен отчёт «Остатки номенклатуры»');
  const nameCol = cols.name;
  const stockCol = cols.stock;
  const recs: StockRec[] = [];
  for (const row of rows.slice(headerEnd + 1)) {
    const name = cellStr(row[nameCol]);
    if (!name) continue;
    const code = cols.code === undefined ? '' : normCode(row[cols.code]);
    const barcode = cols.barcode === undefined ? '' : cellStr(row[cols.barcode]).replace(/\s/g, '');
    if (!code && !barcode) continue; // строки склада и итогов
    const retail = cols.retail === undefined ? null : parseCountNum(row[cols.retail]);
    recs.push({
      name,
      code: code || null,
      barcode: barcode || null,
      group: cols.group === undefined ? '' : cellStr(row[cols.group]),
      unit: cols.unit === undefined ? '' : cellStr(row[cols.unit]).toLowerCase(),
      stock: parseCountNum(row[stockCol]) ?? 0,
      retail: retail !== null && retail > 0 ? retail : null,
    });
  }
  return { recs, stockAt };
}

export interface RetailRec {
  name: string;
  article: string | null;
  group: string | null;
  retail: number;
}

/** Прайс-лист розничных цен: строки без цены — заголовки групп; кода нет, артикул бывает в названии. */
export function parseRetailList(rows: Rows): { recs: RetailRec[]; fileDate: string | null } {
  const det = detectColumns(rows);
  if (!det || det.cols.name === undefined || det.cols.retail === undefined) {
    throw new Error('Не нашёл колонки «Номенклатура» и «Розничный тип цен» в прайс-листе');
  }
  const { cols, dataStart } = det;
  const nameCol = cols.name ?? 0;
  const retailCol = cols.retail ?? 0;
  const recs: RetailRec[] = [];
  let group: string | null = null;
  for (const row of rows.slice(dataStart)) {
    const name = cellStr(row[nameCol]);
    if (!name || /^\s*(итого|всего|номенклатура|наименование)/i.test(name)) continue;
    const retail = parsePriceNum(row[retailCol]);
    if (retail === null) {
      group = name;
      continue;
    }
    const article = /арт[.\s№:]*([0-9a-zа-яё][0-9a-zа-яё\-/.]*)/i.exec(name)?.[1] ?? null;
    recs.push({ name, article, group, retail });
  }
  return { recs, fileDate: parseHeaderDate(rows) };
}

export interface SalesPeriod {
  from: string;
  to: string;
}

/** Период отчёта из шапки: «Период: 01.09.2026 - 30.09.2026»; одна дата — отчёт за день. */
export function parseReportPeriod(rows: Rows): SalesPeriod | null {
  for (const row of rows.slice(0, 14)) {
    const line = row.map(cellStr).join(' ');
    if (!/период/i.test(line)) continue;
    const dates = (line.match(/\d{1,2}\.\d{1,2}\.\d{2,4}/g) ?? []).map(parseDateCell);
    const from = dates[0] ?? null;
    const to = dates[1] ?? from;
    if (from && to) return from <= to ? { from, to } : { from: to, to: from };
  }
  return null;
}

export interface SalesRec {
  name: string;
  code: string | null;
  qty: number;
  /** Выручка в рублях; null — в отчёте нет колонки суммы. */
  amount: number | null;
}

/** «Продажи»: итог за период, обычно без кода — товар узнаётся по названию. Строки «Итого» пропускаются. */
export function parseSalesReport(rows: Rows): { recs: SalesRec[]; period: SalesPeriod | null } {
  const det = detectColumns(rows);
  if (!det) throw new Error('Не нашёл строку заголовков (Номенклатура…) в отчёте «Продажи»');
  const { cols, dataStart } = det;
  if (cols.qty === undefined) throw new Error('Не нашёл колонку «Количество» — выгрузите «Продажи» с количеством');
  const nameCol = cols.name ?? 0;
  const qtyCol = cols.qty;
  const recs = new Map<string, SalesRec>();
  for (const row of rows.slice(dataStart)) {
    const name = cellStr(row[nameCol]);
    if (!name || /^\s*(итого|всего|total)/i.test(name)) continue;
    const qty = parseCountNum(row[qtyCol]);
    if (qty === null) continue;
    const code = cols.code === undefined ? '' : normCode(row[cols.code]);
    const amount = cols.amount === undefined ? null : parsePriceNum(row[cols.amount]);
    const key = code || norm(name);
    let rec = recs.get(key);
    if (!rec) {
      rec = { name, code: code || null, qty: 0, amount: null };
      recs.set(key, rec);
    }
    rec.qty += qty;
    if (amount !== null) rec.amount = (rec.amount ?? 0) + amount;
  }
  return { recs: [...recs.values()], period: parseReportPeriod(rows) };
}
