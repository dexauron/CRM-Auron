// Чтение файла Excel из 1С (.xlsx и .xls) библиотекой SheetJS — она грузится только при выборе файла.
import { detectReportType, parseBarcodesReport, parsePriceReport, parseRetailList, parseStockReport, SUPPORTED, type ReportType, type Rows } from './parse';
import type { ParsedReport } from './plan';

const MAX_FILE = 30 * 1024 * 1024;

export interface FileResult {
  fileName: string;
  type: ReportType | null;
  /** Разобранный отчёт, если такой тип уже загружаем. */
  report: ParsedReport | null;
  rows: number;
  error: string | null;
}

export async function readRows(file: Blob): Promise<Rows> {
  const XLSX = await import('xlsx');
  const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const first = book.SheetNames[0];
  const sheet = first ? book.Sheets[first] : undefined;
  if (!sheet) throw new Error('В файле нет листов');
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
}

export function parseReport(type: ReportType, rows: Rows): ParsedReport | null {
  if (type === 'prices') return { type, items: parsePriceReport(rows) };
  if (type === 'barcodes') return { type, recs: parseBarcodesReport(rows) };
  if (type === 'stock') return { type, recs: parseStockReport(rows).recs };
  if (type === 'retail') return { type, recs: parseRetailList(rows).recs };
  return null;
}

const countOf = (r: ParsedReport) => (r.type === 'prices' ? r.items.length : r.recs.length);

export async function readReport(file: File): Promise<FileResult> {
  const base = { fileName: file.name, type: null, report: null, rows: 0 };
  if (file.size > MAX_FILE) return { ...base, error: 'Файл больше 30 МБ' };
  try {
    const rows = await readRows(file);
    const type = detectReportType(rows);
    if (!type) return { ...base, error: null };
    const report = SUPPORTED.includes(type) ? parseReport(type, rows) : null;
    return { ...base, type, report, rows: report ? countOf(report) : 0, error: null };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : 'Не удалось прочитать файл' };
  }
}
