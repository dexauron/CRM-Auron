// Карточка учётной записи: кто вошёл и в каких магазинах какая роль.
import type { SignInError } from '../../api/auth';
import { ru } from '../../shared/i18n/ru';
import { Avatar } from '../../shared/ui/Avatar';
import { Icon } from '../../shared/ui/icons';
import { Row, Section } from '../../shared/ui/List';
import type { AccountState } from './useAccount';

const errorText: Record<SignInError, string> = {
  expired: ru.account.errors.expired,
  bad_signature: ru.account.errors.notConfirmed,
  malformed: ru.account.errors.notConfirmed,
  from_future: ru.account.errors.notConfirmed,
  no_user: ru.account.errors.notConfirmed,
  account_conflict: ru.account.errors.conflict,
  network: ru.account.errors.network,
  popup_blocked: ru.account.errors.popupBlocked,
  origin_not_allowed: ru.account.errors.unavailable,
  server_not_configured: ru.account.errors.unavailable,
  internal: ru.account.errors.unavailable,
};

interface Props {
  state: AccountState;
  inTelegram: boolean;
  onRetry: () => void;
  /** Вход с ПК через окно Telegram; null — недоступен (сервер не ответил). */
  onBrowserSignIn: (() => void) | null;
}

export function Account({ state, inTelegram, onRetry, onBrowserSignIn }: Props) {
  if (state.kind === 'loading') {
    return (
      <Section>
        <Row leading={<span className="spinner" />} title={ru.account.signingIn} tone="muted" />
      </Section>
    );
  }

  if (state.kind === 'guest') {
    if (inTelegram) {
      return (
        <Section footer={ru.account.signedOut}>
          <Row title={ru.account.signIn} tone="link" center onClick={onRetry} />
        </Section>
      );
    }
    return (
      <Section footer={onBrowserSignIn ? ru.account.browserHint : ru.account.guest}>
        <Row leading={<Avatar name={null} />} inset="avatar" title={ru.account.guestTitle} tone="muted" />
        {onBrowserSignIn && (
          <Row
            leading={<Icon name="telegram" className="row-icon" />}
            title={ru.account.browserSignIn}
            tone="link"
            onClick={onBrowserSignIn}
          />
        )}
      </Section>
    );
  }

  if (state.kind === 'error') {
    return (
      <Section footer={errorText[state.code]}>
        <Row title={ru.account.retry} tone="link" center onClick={onRetry} />
      </Section>
    );
  }

  const { me, invite } = state;
  const roles = me.memberships.map((m) => `${m.orgName} · ${ru.roles[m.role]}`).join(', ');
  return (
    <Section footer={me.memberships.length ? undefined : ru.account.noAccess}>
      <div className="profile">
        <Avatar name={me.fullName} size="large" />
        <span className="profile-text">
          <span className="profile-name">{me.fullName ?? ru.account.noName}</span>
          <span className="profile-roles">{roles || ru.account.noAccessShort}</span>
        </span>
      </div>
      {invite && (
        <div role="status">
          <Row title={ru.account.invite[invite]} tone={invite === 'accepted' ? 'good' : 'bad'} inset="text" />
        </div>
      )}
    </Section>
  );
}
