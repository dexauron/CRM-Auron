import { describe, expect, it } from 'vitest';
import { formatPrice, formatStock, markupPercent } from './format';

const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('КАТ-1: числа карточки товара', () => {
  it('цена: штучный, весовой, без цены', () => {
    expect(nbsp(formatPrice(8900, 'pcs'))).toBe('89,00 ₽');
    expect(nbsp(formatPrice(45050, 'kg'))).toBe('450,50 ₽ / кг');
    expect(formatPrice(null, 'kg')).toBe('—');
  });

  it('остаток: целые штуки и граммы у весовых', () => {
    expect(formatStock(12, 'pcs')).toBe('12 шт');
    expect(formatStock(1.25, 'kg')).toBe('1,25 кг');
    expect(nbsp(formatStock(1250, 'pcs'))).toBe('1 250 шт');
  });

  it('наценка: обычная, ниже закупки, не из чего считать', () => {
    expect(markupPercent(8900, 6500)).toBe(37);
    expect(markupPercent(6000, 6500)).toBe(-8);
    expect(markupPercent(null, 6500)).toBeNull();
    expect(markupPercent(8900, 0)).toBeNull();
    expect(markupPercent(8900, null)).toBeNull();
  });
});
