import { describe, expect, it, vi } from 'vitest';
import { CatalogToolsError, loadCatalogIssues, parseCatalogIssues } from './catalogTools';

const { rpc, abortSignal } = vi.hoisted(() => ({ rpc: vi.fn(), abortSignal: vi.fn() }));
vi.mock('./client', () => ({ api: () => ({ rpc }) }));
const row = { id: 'p1', name: 'Тест', cash_code: '001', unit: 'pcs', retail_price: '9900', purchase_price: '10000', barcode: null, barcode_count: null };
const report = { counts: { missing_price: 0, below_cost: 1, no_markup: 0, duplicate_barcodes: 0 }, total: 1, items: [row] };

describe('КАТ-6: ответ сервера', () => {
  it('разбирает суммы без потери копеек и сохраняет ноль отдельно от отсутствующей цены', () => {
    const items = parseCatalogIssues({ ...report, total: 2, items: [row, { ...row, id: 'p2', retail_price: '0', purchase_price: null }] }).items;
    expect(items[0]?.retailPrice).toBe(9900n);
    expect(items[1]?.retailPrice).toBe(0n);
    expect(items[1]?.purchasePrice).toBeNull();
  });
  it('bigint выше Number.MAX_SAFE_INTEGER не округляется', () => {
    const p = parseCatalogIssues({ ...report, items: [{ ...row, retail_price: '9007199254740992', purchase_price: '9007199254740993' }] }).items[0];
    expect(p?.purchasePrice).toBe(9007199254740993n);
    expect(p?.retailPrice).toBe(9007199254740992n);
  });
  it.each([1.5, 100, '-1', '12.34', 'NaN', '9223372036854775808', undefined])('отклоняет неверную сумму %s, не превращая её в ноль', (value) => {
    expect(() => parseCatalogIssues({ ...report, items: [{ ...row, retail_price: value }] })).toThrow(CatalogToolsError);
  });
  it('считает общий штрихкод отдельно от числа товаров с ним', () => {
    const result = parseCatalogIssues({ ...report, counts: { ...report.counts, duplicate_barcodes: 1 }, total: 2,
      items: [row, { ...row, id: 'p2' }].map((p) => ({ ...p, barcode: '0123456789012', barcode_count: 2 })) });
    expect(result.counts.duplicate_barcodes).toBe(1);
    expect(result.items.map((p) => p.barcode)).toEqual(['0123456789012', '0123456789012']);
  });
  it.each([null, {}, { ...report, counts: {} }, { ...report, total: -1 }, { ...report, total: 0 }, { ...report, items: [null] }])('не показывает неполный отчёт как успешный', (value) => {
    expect(() => parseCatalogIssues(value)).toThrow(CatalogToolsError);
  });
  it('пустой каталог — корректный пустой результат', () => {
    expect(parseCatalogIssues({ ...report, total: 0, items: [], counts: { ...report.counts, below_cost: 0 } }).items).toEqual([]);
  });
});

describe('КАТ-6: запрос инструментов', () => {
  it('передаёт магазин, фильтр, страницу и сигнал отмены; не читает таблицы напрямую', async () => {
    rpc.mockReturnValue({ abortSignal });
    abortSignal.mockResolvedValue({ data: report, error: null });
    const signal = new AbortController().signal;
    await expect(loadCatalogIssues('store', 'below_cost', 50, signal)).resolves.toMatchObject({ total: 1 });
    expect(rpc).toHaveBeenLastCalledWith('catalog_issues', { p_org: 'store', p_kind: 'below_cost', p_offset: 50, p_limit: 50 });
    expect(abortSignal).toHaveBeenLastCalledWith(signal);
  });
  it('отказ сервера не становится пустым зелёным отчётом', async () => {
    rpc.mockReturnValue({ abortSignal });
    abortSignal.mockResolvedValue({ data: null, error: { code: '42501' } });
    await expect(loadCatalogIssues('store', 'below_cost', 0, new AbortController().signal)).rejects.toMatchObject({ reason: 'forbidden' });
  });
});
