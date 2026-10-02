import { describe, expect, it } from 'vitest';
import { groupSecret, isTotpCode } from './mfa';

describe('isTotpCode', () => {
  it('ровно 6 цифр', () => {
    expect(isTotpCode('012345')).toBe(true);
    for (const code of ['12345', '1234567', '12345a', ' 123456', '']) expect(isTotpCode(code)).toBe(false);
  });
});

describe('groupSecret', () => {
  it('делит ключ по 4 символа', () => {
    expect(groupSecret('JBSWY3DPEHPK3PXPAB')).toBe('JBSW Y3DP EHPK 3PXP AB');
  });
});
