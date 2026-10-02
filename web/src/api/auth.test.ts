import { describe, expect, it } from 'vitest';
import { parseMemberships, signInErrorFrom } from './auth';

describe('signInErrorFrom', () => {
  it('пропускает известные коды сервера', () => {
    expect(signInErrorFrom({ error: 'expired' })).toBe('expired');
    expect(signInErrorFrom({ error: 'account_conflict' })).toBe('account_conflict');
  });

  it('всё остальное — internal', () => {
    for (const body of [null, 'expired', {}, { error: 'drop table' }, { error: 42 }]) {
      expect(signInErrorFrom(body)).toBe('internal');
    }
  });
});

describe('parseMemberships', () => {
  it('собирает роли с названием магазина', () => {
    expect(parseMemberships([{ org_id: 'o1', role: 'owner', organizations: { name: 'Way Market' } }])).toEqual([
      { orgId: 'o1', orgName: 'Way Market', role: 'owner' },
    ]);
  });

  it('отбрасывает строки без магазина и с незнакомой ролью', () => {
    expect(
      parseMemberships([
        { org_id: 'o1', role: 'owner', organizations: null },
        { org_id: 'o2', role: 'admin', organizations: { name: 'X' } },
        'мусор',
      ]),
    ).toEqual([]);
    expect(parseMemberships(null)).toEqual([]);
  });
});
