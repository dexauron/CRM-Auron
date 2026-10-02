import { expect, it } from 'vitest';
import { formatExactRub } from './money';

it.each([[0n, '0,00₽'], [1n, '0,01₽'], [-12345n, '-123,45₽'], [9223372036854775807n, '92233720368547758,07₽']])(
  'КАТ-6: форматирование bigint %s без округления копеек', (amount, expected) => {
    expect(formatExactRub(amount).replace(/\s/g, '')).toBe(expected);
  },
);
