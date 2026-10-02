import { describe, expect, it } from 'vitest';
import { initials } from './avatar';

describe('initials', () => {
  it('первые буквы двух первых слов', () => {
    expect(initials('Адам Чеченский')).toBe('АЧ');
    expect(initials('  анна   мария  сидорова ')).toBe('АМ');
  });

  it('одно слово, пусто, нет имени', () => {
    expect(initials('Покупатель')).toBe('П');
    expect(initials('')).toBe('?');
    expect(initials(null)).toBe('?');
  });
});
