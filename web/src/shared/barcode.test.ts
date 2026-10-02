import { describe, expect, it } from 'vitest';
import { barcodeVariants, findByBarcode, isValidGtin, normalizeScanned, ScanFilter } from './barcode';

describe('КАТ-3: штрихкоды со сканера', () => {
  it('контрольная цифра EAN-13, EAN-8, UPC-A', () => {
    expect(isValidGtin('4600000000015')).toBe(true);
    expect(isValidGtin('4600000000012')).toBe(false);
    expect(isValidGtin('96385074')).toBe(true);
    expect(isValidGtin('036000291452')).toBe(true);
    expect(isValidGtin('2322439002621')).toBe(true);
    expect(isValidGtin('12345')).toBe(false);
    expect(isValidGtin('abc4600000001')).toBe(false);
  });

  it('GTIN из DataMatrix «Честного знака» и GS1-128', () => {
    const gs = String.fromCharCode(29);
    expect(normalizeScanned('0104600000000015215abcDEF' + gs + '93AbCd')).toBe('4600000000015');
    expect(normalizeScanned(gs + '0104600000000015215abc')).toBe('4600000000015');
    expect(normalizeScanned(']d20104600000000015215abc')).toBe('4600000000015');
    expect(normalizeScanned('(01)04600000000015(21)5abc')).toBe('4600000000015');
    expect(normalizeScanned('0114600000000018')).toBe('14600000000018');
    expect(normalizeScanned(' 4600000000015 ')).toBe('4600000000015');
  });

  it('UPC-A и EAN-13 с нулём — один товар', () => {
    expect(barcodeVariants('036000291452')).toEqual(['036000291452', '0036000291452']);
    expect(barcodeVariants('0036000291452')).toEqual(['0036000291452', '036000291452']);
    expect(barcodeVariants('4600000000015')).toEqual(['4600000000015']);
    const products = [
      { id: 'a', barcodes: ['0036000291452'] },
      { id: 'b', barcodes: ['4600000000015', '4600000000028'] },
      { id: 'c', barcodes: [] },
    ];
    expect(findByBarcode(products, '036000291452').map((p) => p.id)).toEqual(['a']);
    expect(findByBarcode(products, '4600000000028').map((p) => p.id)).toEqual(['b']);
    expect(findByBarcode(products, '4600000000035')).toEqual([]);
  });

  it('ошибочное чтение не проходит, верный EAN — сразу, прочее — после двух совпадений', () => {
    const f = new ScanFilter();
    expect(f.push('4600000000015')).toBe('4600000000015');
    expect(f.push('4600000000012')).toBeNull();
    expect(f.push('INV-001')).toBeNull();
    expect(f.push('INV-001')).toBe('INV-001');
    expect(f.push('')).toBeNull();
  });
});
