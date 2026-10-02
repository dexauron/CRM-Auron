import { describe, expect, it } from 'vitest';
import { formatShortDateTime } from './date';

describe('formatShortDateTime', () => {
  it('показывает время магазина (UTC+3)', () => {
    expect(formatShortDateTime('2026-10-05T11:30:00Z')).toBe('05.10, 14:30');
  });

  it('битая дата — прочерк', () => {
    expect(formatShortDateTime('вчера')).toBe('—');
  });
});
