import { describe, expect, it } from 'vitest';
import { formatRub, parseRub } from './money';

const plain = (s: string) => s.replace(/\s/g, ' ');

describe('formatRub', () => {
  it('показывает копейки как рубли', () => {
    expect(plain(formatRub(123456))).toBe('1 234,56 ₽');
    expect(plain(formatRub(0))).toBe('0,00 ₽');
    expect(plain(formatRub(-5000))).toBe('-50,00 ₽');
  });
  it('не принимает дробные копейки', () => {
    expect(() => formatRub(10.5)).toThrow(RangeError);
  });
});

describe('parseRub', () => {
  it('понимает привычные записи сумм', () => {
    expect(parseRub('1 234,56')).toBe(123456);
    expect(parseRub('1234.5')).toBe(123450);
    expect(parseRub('1234')).toBe(123400);
    expect(parseRub('1 234 ₽')).toBe(123400);
    expect(parseRub('0,07')).toBe(7);
  });
  it('считает без ошибок округления', () => {
    // 0,1 + 0,2 в дробях даёт 0,30000000000000004 — здесь такого быть не должно
    expect(parseRub('0,29')).toBe(29);
    expect(parseRub('19,99')).toBe(1999);
  });
  it('отклоняет мусор и лишние знаки', () => {
    expect(parseRub('')).toBeNull();
    expect(parseRub('abc')).toBeNull();
    expect(parseRub('1,234')).toBeNull();
    expect(parseRub('1.2.3')).toBeNull();
  });
  it('минус только по разрешению', () => {
    expect(parseRub('-50')).toBeNull();
    expect(parseRub('-50', { allowNegative: true })).toBe(-5000);
  });
});
