import { describe, expect, it } from 'vitest';
import { parseInviteParam } from './invite';

const token = 'a1'.repeat(32);

describe('parseInviteParam', () => {
  it('достаёт токен из inv_<64 hex>', () => {
    expect(parseInviteParam(`inv_${token}`)).toBe(token);
  });

  it('отбрасывает пустое, чужое и испорченное', () => {
    for (const value of [undefined, null, '', token, `inv_${token.slice(1)}`, `inv_${token}0`, `inv_${token.toUpperCase()}`, `x_inv_${token}`]) {
      expect(parseInviteParam(value)).toBeNull();
    }
  });
});
