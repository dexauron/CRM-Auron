// Числа карточки товара: цена с единицей, остаток, наценка.
import { ru } from '../../shared/i18n/ru';
import { formatRub } from '../../shared/money';

/** «89,00 ₽», у весовых «89,00 ₽ / кг»; нет цены — прочерк. */
export function formatPrice(kopecks: number | null, unit: 'pcs' | 'kg'): string {
  return kopecks === null ? '—' : formatRub(kopecks) + (unit === 'kg' ? ru.catalog.perKg : '');
}

const quantity = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });

/** «12 шт», «1,25 кг». */
export function formatStock(stock: number, unit: 'pcs' | 'kg'): string {
  return `${quantity.format(stock)} ${ru.catalog.units[unit]}`;
}

/** Наценка к закупке в целых процентах; null — если считать не из чего. */
export function markupPercent(retail: number | null, purchase: number | null): number | null {
  if (retail === null || purchase === null || purchase <= 0) return null;
  return Math.round(((retail - purchase) / purchase) * 100);
}
