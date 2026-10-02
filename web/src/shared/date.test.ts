import { describe, expect, it } from 'vitest';
import { formatDate, formatDay, formatShortDateTime } from './date';

describe('formatShortDateTime', () => {
  it('показывает время магазина (UTC+3)', () => {
    expect(formatShortDateTime('2026-10-05T11:30:00Z')).toBe('05.10, 14:30');
  });

  it('битая дата — прочерк', () => {
    expect(formatShortDateTime('вчера')).toBe('—');
  });
});

describe('formatDay', () => {
  it('показывает дату без сдвига часового пояса', () => {
    expect(formatDay('2026-10-02')).toBe('2 октября 2026 г.');
    expect(formatDay('2026-01-01')).toBe('1 января 2026 г.');
  });
  it('не падает на мусоре', () => {
    expect(formatDay('вчера')).toBe('—');
  });
});

describe('formatDate', () => {
  it('переводит время в день магазина (UTC+3)', () => {
    expect(formatDate('2026-10-01T22:30:00Z')).toBe('02.10.2026');
    expect(formatDate('не дата')).toBe('—');
  });
});
