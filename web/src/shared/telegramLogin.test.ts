import { describe, expect, it } from 'vitest';
import { parseAuthMessage } from './telegramLogin';

describe('parseAuthMessage', () => {
  it('данные входа — объект', () => {
    expect(parseAuthMessage(JSON.stringify({ event: 'auth_result', result: { id: 42, hash: 'x' } }))).toEqual({ id: 42, hash: 'x' });
  });

  it('отказ — null', () => {
    expect(parseAuthMessage(JSON.stringify({ event: 'auth_result', result: false }))).toBeNull();
  });

  it('чужие и битые сообщения — undefined', () => {
    for (const data of ['{"event":"resize"}', 'не json', 42, null, { event: 'other' }]) {
      expect(parseAuthMessage(data)).toBeUndefined();
    }
  });
});
