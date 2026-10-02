// Штрихкоды со сканера (КАТ-3): контрольная цифра, GTIN из «Честного знака», UPC-A = EAN-13 с нулём впереди.

/** Контрольная цифра GTIN (EAN-8, UPC-A, EAN-13, GTIN-14) верна. */
export function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

const GS1_SEPARATOR = String.fromCharCode(29);

/**
 * Код со сканера → код для поиска. DataMatrix «Честного знака» и GS1-128 начинаются с (01) и GTIN-14:
 * берём GTIN, а GTIN-14 с нулём впереди — это обычный EAN-13 на упаковке.
 */
export function normalizeScanned(raw: string): string {
  let s = raw.trim();
  if (s.startsWith(']d2') || s.startsWith(']C1') || s.startsWith(']Q3')) s = s.slice(3);
  if (s.startsWith(GS1_SEPARATOR)) s = s.slice(1);
  const gs1 = /^\(?01\)?(\d{14})/.exec(s);
  if (gs1?.[1] && s.length >= 16) return gs1[1].startsWith('0') ? gs1[1].slice(1) : gs1[1];
  return s;
}

/** Варианты записи одного кода: UPC-A (12 цифр) и EAN-13 с нулём впереди — один товар. */
export function barcodeVariants(code: string): string[] {
  if (/^\d{12}$/.test(code)) return [code, `0${code}`];
  if (/^0\d{12}$/.test(code)) return [code, code.slice(1)];
  return [code];
}

/** Товары с этим штрихкодом (с учётом записи UPC-A / EAN-13). */
export function findByBarcode<T extends { barcodes: readonly string[] }>(products: readonly T[], code: string): T[] {
  const variants = new Set(barcodeVariants(code));
  return products.filter((p) => p.barcodes.some((b) => variants.has(b)));
}

/**
 * Защита от ошибочного чтения: код с верной контрольной цифрой принимается сразу,
 * остальные (Code 128, QR, внутренние коды) — когда два чтения подряд совпали.
 */
export class ScanFilter {
  private last: string | null = null;

  push(raw: string): string | null {
    const code = normalizeScanned(raw);
    if (!code || code.length > 64) return null;
    if (isValidGtin(code)) return code;
    const confirmed = code === this.last;
    this.last = code;
    return confirmed ? code : null;
  }
}
