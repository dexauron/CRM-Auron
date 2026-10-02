// Вход и текущий пользователь: логика отдельно от вёрстки.
import { useCallback, useEffect, useState } from 'react';
import {
  acceptInvite,
  privilegedRoles,
  currentSession,
  loadMe,
  sessionTelegramId,
  signInWithTelegram,
  signOut,
  SignInFailed,
  type InviteResult,
  type Me,
  type SignInError,
} from '../../api/auth';
import { secondFactorState, type SecondFactorState } from '../../api/mfa';
import { parseInviteParam } from '../../shared/invite';
import type { TelegramWebApp } from '../../shared/telegram';

export type AccountState =
  | { kind: 'loading' }
  | { kind: 'guest' }
  | { kind: 'error'; code: SignInError }
  | { kind: 'ready'; me: Me; invite: InviteResult | null; secondFactor: SecondFactorState };

// Владельцу, управляющему и бухгалтеру нужен код из приложения-аутентификатора; остальным — нет.
async function withSecondFactor(me: Me, invite: InviteResult | null): Promise<AccountState> {
  const privileged = me.memberships.some((m) => privilegedRoles.includes(m.role));
  return { kind: 'ready', me, invite, secondFactor: privileged ? await secondFactorState() : 'ok' };
}

// Telegram повторяет start_param при каждой перезагрузке страницы: приглашение принимаем один раз за запуск.
async function acceptOnce(token: string): Promise<InviteResult | null> {
  const mark = `invite:${token.slice(0, 8)}`;
  try {
    if (window.sessionStorage.getItem(mark)) return null;
    window.sessionStorage.setItem(mark, '1');
  } catch {
    // Хранилище недоступно — просто принимаем.
  }
  return acceptInvite(token);
}

async function establish(telegram: TelegramWebApp | null): Promise<AccountState> {
  const signIn = async () => {
    if (!telegram) return null;
    await signInWithTelegram(telegram.initData);
    return currentSession();
  };
  let session = await currentSession();
  if (telegram) {
    const telegramId = telegram.initDataUnsafe.user?.id;
    // Нет сессии или она чужая (другой человек на том же устройстве) — входим заново.
    if (!session || telegramId === undefined || sessionTelegramId(session) !== telegramId) session = await signIn();
  }
  if (!session) return { kind: 'guest' };
  const token = telegram ? parseInviteParam(telegram.initDataUnsafe.start_param) : null;
  const invite = token ? await acceptOnce(token) : null;
  let me: Me;
  try {
    me = await loadMe(session.user.id);
  } catch (error) {
    // Сессию могли закрыть на сервере (например, после отключения доступа) — в Telegram входим заново.
    if (!telegram) throw error;
    session = await signIn();
    if (!session) return { kind: 'guest' };
    me = await loadMe(session.user.id);
  }
  return withSecondFactor(me, invite);
}

/** telegram: undefined — ещё выясняем, открыто ли приложение из Telegram; enabled — настроен ли сервер. */
export function useAccount(telegram: TelegramWebApp | null | undefined, enabled: boolean) {
  const [state, setState] = useState<AccountState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || telegram === undefined) return;
    let active = true;
    establish(telegram).then(
      (next) => {
        if (active) setState(next);
      },
      (error: unknown) => {
        if (active) setState({ kind: 'error', code: error instanceof SignInFailed ? error.code : 'internal' });
      },
    );
    return () => {
      active = false;
    };
  }, [telegram, attempt, enabled]);

  const retry = useCallback(() => {
    setState({ kind: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  const leave = useCallback(() => {
    void signOut().finally(() => setState({ kind: 'guest' }));
  }, []);

  return { state, retry, signOut: leave };
}
