import { describe, expect, it } from 'vitest';
import { inviteLink, parseInvites, parseMembers } from './team';

describe('inviteLink', () => {
  it('ссылка открывает приложение в боте с параметром inv_', () => {
    expect(inviteLink('auron_core_bot', 'ab'.repeat(32))).toBe(`https://t.me/auron_core_bot?startapp=inv_${'ab'.repeat(32)}`);
  });
});

describe('parseInvites', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');

  it('определяет состояние: действует, принято, истекло', () => {
    expect(
      parseInvites(
        [
          { id: 'a', role: 'staff', expires_at: '2026-10-03T12:00:00Z', used_at: null },
          { id: 'b', role: 'manager', expires_at: '2026-10-03T12:00:00Z', used_at: '2026-10-02T11:00:00Z' },
          { id: 'c', role: 'supplier', expires_at: '2026-10-02T12:00:00Z', used_at: null },
        ],
        now,
      ).map((i) => i.state),
    ).toEqual(['active', 'used', 'expired']);
  });

  it('отбрасывает битые строки', () => {
    expect(parseInvites([{ id: 'a', role: 'admin', expires_at: 'x' }, null], now)).toEqual([]);
  });
});

describe('parseMembers', () => {
  it('подставляет имена из профилей, без профиля — null', () => {
    expect(
      parseMembers(
        [
          { id: 'm1', user_id: 'u1', role: 'owner', status: 'active' },
          { id: 'm2', user_id: 'u2', role: 'staff', status: 'disabled' },
        ],
        [{ id: 'u1', full_name: 'Владелец' }],
      ),
    ).toEqual([
      { id: 'm1', userId: 'u1', role: 'owner', status: 'active', fullName: 'Владелец' },
      { id: 'm2', userId: 'u2', role: 'staff', status: 'disabled', fullName: null },
    ]);
  });

  it('отбрасывает незнакомые роли и статусы', () => {
    expect(parseMembers([{ id: 'm', user_id: 'u', role: 'staff', status: 'banned' }], [])).toEqual([]);
  });
});
