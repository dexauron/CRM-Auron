// Команда магазина (СОТ-1): приглашения и участники. Права проверяет база: всё это доступно только владельцу.
import { api } from './client';
import { roles, type Role } from './auth';

export const invitableRoles = ['manager', 'accountant', 'staff', 'supplier'] as const satisfies readonly Role[];
export type InvitableRole = (typeof invitableRoles)[number];
export const inviteTtlHours = [24, 72, 168] as const;

export type InviteState = 'active' | 'used' | 'expired';

export interface Invite {
  id: string;
  role: Role;
  expiresAt: string;
  state: InviteState;
}

export type MemberStatus = 'active' | 'disabled';

export interface Member {
  id: string;
  userId: string;
  role: Role;
  status: MemberStatus;
  fullName: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isRole = (value: unknown): value is Role => (roles as readonly unknown[]).includes(value);

export function inviteLink(bot: string, token: string): string {
  return `https://t.me/${bot}?startapp=inv_${token}`;
}

export function parseInvites(rows: unknown, now = Date.now()): Invite[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown) => {
    if (!isRecord(row)) return [];
    const { id, role, expires_at: expiresAt, used_at: usedAt } = row;
    if (typeof id !== 'string' || !isRole(role) || typeof expiresAt !== 'string') return [];
    const state: InviteState = usedAt ? 'used' : Date.parse(expiresAt) <= now ? 'expired' : 'active';
    return [{ id, role, expiresAt, state }];
  });
}

export function parseMembers(memberships: unknown, profiles: unknown): Member[] {
  const names = new Map<string, string | null>();
  if (Array.isArray(profiles)) {
    for (const p of profiles as unknown[]) {
      if (isRecord(p) && typeof p.id === 'string') names.set(p.id, typeof p.full_name === 'string' ? p.full_name : null);
    }
  }
  if (!Array.isArray(memberships)) return [];
  return memberships.flatMap((row: unknown) => {
    if (!isRecord(row)) return [];
    const { id, user_id: userId, role, status } = row;
    if (typeof id !== 'string' || typeof userId !== 'string' || !isRole(role)) return [];
    if (status !== 'active' && status !== 'disabled') return [];
    return [{ id, userId, role, status, fullName: names.get(userId) ?? null }];
  });
}

/** Возвращает токен: он показывается один раз, в базе остаётся только хэш. */
export async function createInvite(orgId: string, role: InvitableRole, ttlHours: number): Promise<string> {
  const { data, error } = await api().rpc('create_invite', { p_org: orgId, p_role: role, p_ttl_hours: ttlHours });
  if (error || typeof data !== 'string') throw new Error('Не удалось создать приглашение');
  return data;
}

export async function listInvites(orgId: string): Promise<Invite[]> {
  const { data, error } = await api()
    .from('invites')
    .select('id, role, expires_at, used_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw new Error('Не удалось загрузить приглашения');
  return parseInvites(data);
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const { error } = await api().rpc('revoke_invite', { p_invite: inviteId });
  if (error) throw new Error('Не удалось отозвать приглашение');
}

export async function listMembers(orgId: string): Promise<Member[]> {
  const memberships = await api()
    .from('memberships')
    .select('id, user_id, role, status')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });
  if (memberships.error) throw new Error('Не удалось загрузить участников');
  const ids = (memberships.data as unknown[]).flatMap((m) => (isRecord(m) && typeof m.user_id === 'string' ? [m.user_id] : []));
  const profiles = ids.length ? await api().from('profiles').select('id, full_name').in('id', ids) : { data: [], error: null };
  if (profiles.error) throw new Error('Не удалось загрузить участников');
  return parseMembers(memberships.data, profiles.data);
}

export async function setMemberStatus(membershipId: string, status: MemberStatus): Promise<void> {
  const { error } = await api().rpc('set_member_status', { p_membership: membershipId, p_status: status });
  if (error) throw new Error('Не удалось изменить доступ');
}
