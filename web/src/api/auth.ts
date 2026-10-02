// Вход и текущий пользователь. Сессию выдаёт серверная функция auth-telegram
// по данным запуска, подписанным Telegram; паролей нет (ТЗ, раздел 6).
import type { Session } from '@supabase/supabase-js';
import { api } from './client';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const roles = ['owner', 'manager', 'accountant', 'staff', 'supplier', 'customer'] as const;
export type Role = (typeof roles)[number];
/** Роли, которым нужен второй фактор (код из приложения-аутентификатора). */
export const privilegedRoles: readonly Role[] = ['owner', 'manager', 'accountant'];

export interface Membership {
  orgId: string;
  orgName: string;
  role: Role;
}

export interface Me {
  userId: string;
  fullName: string | null;
  memberships: Membership[];
}

export const signInErrors = [
  'malformed',
  'bad_signature',
  'expired',
  'from_future',
  'no_user',
  'account_conflict',
  'origin_not_allowed',
  'server_not_configured',
  'network',
  'popup_blocked',
  'internal',
] as const;
export type SignInError = (typeof signInErrors)[number];

export class SignInFailed extends Error {
  constructor(readonly code: SignInError) {
    super(code);
    this.name = 'SignInFailed';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Код ошибки из ответа сервера; неизвестное сводится к internal. */
export function signInErrorFrom(body: unknown): SignInError {
  const code = isRecord(body) ? body.error : undefined;
  return (signInErrors as readonly unknown[]).includes(code) ? (code as SignInError) : 'internal';
}

async function exchange(payload: { initData: string } | { widget: Record<string, unknown> }): Promise<void> {
  if (!url || !key) throw new SignInFailed('server_not_configured');
  let response: Response;
  try {
    response = await fetch(`${url}/functions/v1/auth-telegram`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new SignInFailed('network');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new SignInFailed(signInErrorFrom(body));
  if (!isRecord(body) || typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') {
    throw new SignInFailed('internal');
  }
  const { error } = await api().auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
  if (error) throw new SignInFailed('internal');
}

/** Вход из Telegram (Mini App): данные запуска, подписанные Telegram. */
export const signInWithTelegram = (initData: string) => exchange({ initData });

/** Вход с ПК: данные из окна Telegram Login. */
export const signInWithTelegramWidget = (widget: Record<string, unknown>) => exchange({ widget });

/** Номер бота для окна Telegram Login (не секрет). null — сервер недоступен. */
export async function fetchBotId(): Promise<number | null> {
  if (!url) return null;
  try {
    const body: unknown = await fetch(`${url}/functions/v1/auth-telegram`).then((r) => r.json());
    return isRecord(body) && typeof body.botId === 'number' ? body.botId : null;
  } catch {
    return null;
  }
}

export async function currentSession(): Promise<Session | null> {
  const { data } = await api().auth.getSession();
  return data.session;
}

/** Telegram ID, к которому привязана сессия (записан сервером в app_metadata, пользователь его не меняет). */
export function sessionTelegramId(session: Session): number | null {
  const id: unknown = session.user.app_metadata['telegram_id'];
  return typeof id === 'number' ? id : null;
}

/** Строки memberships с вложенной организацией → роли; чужое и битое отбрасывается. */
export function parseMemberships(rows: unknown): Membership[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown) => {
    if (!isRecord(row) || !isRecord(row.organizations)) return [];
    const { org_id: orgId, role } = row;
    const orgName = row.organizations.name;
    if (typeof orgId !== 'string' || typeof orgName !== 'string') return [];
    if (!(roles as readonly unknown[]).includes(role)) return [];
    return [{ orgId, orgName, role: role as Role }];
  });
}

export async function loadMe(userId: string): Promise<Me> {
  const [profile, memberships] = await Promise.all([
    api().from('profiles').select('full_name').eq('id', userId).maybeSingle(),
    api().from('memberships').select('org_id, role, organizations(name)').eq('user_id', userId).eq('status', 'active'),
  ]);
  if (profile.error || memberships.error) throw new Error('Не удалось загрузить учётную запись');
  const fullName: unknown = isRecord(profile.data) ? profile.data.full_name : null;
  return {
    userId,
    fullName: typeof fullName === 'string' ? fullName : null,
    memberships: parseMemberships(memberships.data),
  };
}

export type InviteResult = 'accepted' | 'invalid' | 'failed';

export async function acceptInvite(token: string): Promise<InviteResult> {
  const { error } = await api().rpc('accept_invite', { p_token: token });
  if (!error) return 'accepted';
  return error.code === '22023' ? 'invalid' : 'failed';
}

export async function signOut(): Promise<void> {
  await api().auth.signOut({ scope: 'local' });
}
