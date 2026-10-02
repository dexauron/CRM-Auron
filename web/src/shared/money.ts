/**
 * Деньги в системе — целые копейки (ТЗ, раздел 6). Дробные числа для денег не используются:
 * рубли появляются только при показе на экране.
 */
export type Kopecks = number;

const rub = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function isKopecks(value: number): value is Kopecks {
  return Number.isSafeInteger(value);
}

/** 123456 → «1 234,56 ₽» */
export function formatRub(kopecks: Kopecks): string {
  if (!isKopecks(kopecks)) {
    throw new RangeError(`Сумма должна быть целым числом копеек: ${String(kopecks)}`);
  }
  return rub.format(kopecks / 100);
}

/**
 * Разбор суммы, введённой человеком: «1 234,56», «1234.5», «1234 ₽».
 * Возвращает копейки или null, если ввод не похож на сумму. Не использует умножение дробей.
 */
export function parseRub(input: string, options: { allowNegative?: boolean } = {}): Kopecks | null {
  const cleaned = input.replace(/[\s₽]/g, '').replace(',', '.');
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const minus = match[1] === '-';
  if (minus && options.allowNegative !== true) return null;
  const rubles = Number(match[2] ?? '0');
  const kopecks = Number((match[3] ?? '').padEnd(2, '0'));
  const value = rubles * 100 + kopecks;
  if (!isKopecks(value)) return null;
  return minus ? -value : value;
}
