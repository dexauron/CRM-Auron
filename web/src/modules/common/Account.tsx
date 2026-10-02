// Учётная запись: вход через Telegram, имя, роли, принятие приглашения из ссылки.
import { useEffect, useState } from 'react';
import {
  acceptInvite,
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
import { ru } from '../../shared/i18n/ru';
import { parseInviteParam } from '../../shared/invite';
import type { TelegramWebApp } from '../../shared/telegram';

type State =
  | { kind: 'loading' }
  | { kind: 'guest' }
  | { kind: 'error'; code: SignInError }
  | { kind: 'ready'; me: Me; invite: InviteResult | null };

const errorText: Record<SignInError, string> = {
  expired: ru.account.errors.expired,
  bad_signature: ru.account.errors.notConfirmed,
  malformed: ru.account.errors.notConfirmed,
  from_future: ru.account.errors.notConfirmed,
  no_user: ru.account.errors.notConfirmed,
  account_conflict: ru.account.errors.conflict,
  network: ru.account.errors.network,
  origin_not_allowed: ru.account.errors.unavailable,
  server_not_configured: ru.account.errors.unavailable,
  internal: ru.account.errors.unavailable,
};

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

async function establish(telegram: TelegramWebApp | null): Promise<State> {
  let session = await currentSession();
  if (telegram) {
    const telegramId = telegram.initDataUnsafe.user?.id;
    // Нет сессии или она чужая (другой человек на том же устройстве) — входим заново.
    if (!session || telegramId === undefined || sessionTelegramId(session) !== telegramId) {
      await signInWithTelegram(telegram.initData);
      session = await currentSession();
    }
  }
  if (!session) return { kind: 'guest' };
  const token = telegram ? parseInviteParam(telegram.initDataUnsafe.start_param) : null;
  const invite = token ? await acceptOnce(token) : null;
  return { kind: 'ready', me: await loadMe(session.user.id), invite };
}

/** telegram: undefined — ещё выясняем, открыто ли приложение из Telegram. */
export function Account({ telegram }: { telegram: TelegramWebApp | null | undefined }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (telegram === undefined) return;
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
  }, [telegram, attempt]);

  const retry = () => {
    setState({ kind: 'loading' });
    setAttempt((n) => n + 1);
  };

  return (
    <section className="account" aria-live="polite">
      <h2 className="section-title">{ru.account.title}</h2>
      {state.kind === 'loading' && <p className="account-text">{ru.account.signingIn}</p>}

      {state.kind === 'guest' && (
        <>
          <p className="account-text">{telegram ? ru.account.signedOut : ru.account.guest}</p>
          {telegram && (
            <button type="button" className="button" onClick={retry}>
              {ru.account.signIn}
            </button>
          )}
        </>
      )}

      {state.kind === 'error' && (
        <>
          <p className="account-text account-error">{errorText[state.code]}</p>
          <button type="button" className="button" onClick={retry}>
            {ru.account.retry}
          </button>
        </>
      )}

      {state.kind === 'ready' && (
        <>
          <p className="account-text">{ru.account.hello(state.me.fullName ?? ru.account.noName)}</p>
          {state.invite && (
            <p className={`account-text ${state.invite === 'accepted' ? 'account-ok' : 'account-error'}`} role="status">
              {ru.account.invite[state.invite]}
            </p>
          )}
          {state.me.memberships.length > 0 ? (
            <ul className="account-roles">
              {state.me.memberships.map(({ orgId, orgName, role }) => (
                <li key={`${orgId}:${role}`}>
                  {orgName} · {ru.roles[role]}
                </li>
              ))}
            </ul>
          ) : (
            <p className="account-text account-muted">{ru.account.noAccess}</p>
          )}
          <button
            type="button"
            className="button button-quiet"
            onClick={() => void signOut().finally(() => setState({ kind: 'guest' }))}
          >
            {ru.account.signOut}
          </button>
        </>
      )}
    </section>
  );
}
