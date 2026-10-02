// Карточка учётной записи: кто вошёл и в каких магазинах какая роль.
import type { SignInError } from '../../api/auth';
import { ru } from '../../shared/i18n/ru';
import { Avatar } from '../../shared/ui/Avatar';
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
  origin_not_allowed: ru.account.errors.unavailable,
  server_not_configured: ru.account.errors.unavailable,
  internal: ru.account.errors.unavailable,
};

export function Account({ state, inTelegram, onRetry }: { state: AccountState; inTelegram: boolean; onRetry: () => void }) {
  if (state.kind === 'loading') {
    return (
      <Section>
        <Row leading={<span className="spinner" />} title={ru.account.signingIn} tone="muted" />
      </Section>
    );
  }

  if (state.kind === 'guest') {
    return (
      <Section footer={inTelegram ? ru.account.signedOut : ru.account.guest}>
        {inTelegram ? (
          <Row title={ru.account.signIn} tone="link" center onClick={onRetry} />
        ) : (
          <Row leading={<Avatar name={null} />} inset="avatar" title={ru.account.guestTitle} tone="muted" />
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
