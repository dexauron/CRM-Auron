// Команда магазина (СОТ-1): ссылка-приглашение с ролью, отзыв приглашения, отключение доступа. Только для владельца.
import { useEffect, useState } from 'react';
import {
  createInvite,
  inviteLink,
  invitableRoles,
  inviteTtlHours,
  listInvites,
  listMembers,
  revokeInvite,
  setMemberStatus,
  type Invite,
  type InvitableRole,
  type Member,
} from '../../api/team';
import { TELEGRAM_BOT } from '../../shared/config';
import { formatShortDateTime } from '../../shared/date';
import { ru } from '../../shared/i18n/ru';
import type { TelegramWebApp } from '../../shared/telegram';

interface Props {
  orgId: string;
  orgName: string;
  selfId: string;
  telegram: TelegramWebApp | null;
}

interface CreatedLink {
  url: string;
  role: InvitableRole;
  ttlHours: number;
}

export function Team({ orgId, orgName, selfId, telegram }: Props) {
  const [role, setRole] = useState<InvitableRole>('staff');
  const [ttlHours, setTtlHours] = useState<number>(72);
  const [link, setLink] = useState<CreatedLink | null>(null);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([listInvites(orgId), listMembers(orgId)]).then(
      ([nextInvites, nextMembers]) => {
        if (!active) return;
        setInvites(nextInvites);
        setMembers(nextMembers.filter((m) => m.role !== 'customer'));
      },
      () => {
        if (active) setError(ru.team.errors.load);
      },
    );
    return () => {
      active = false;
    };
  }, [orgId, version]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(ru.team.errors.action);
    } finally {
      setBusy(false);
      setVersion((n) => n + 1);
    }
  };

  const create = () =>
    run(async () => {
      const token = await createInvite(orgId, role, ttlHours);
      setLink({ url: inviteLink(TELEGRAM_BOT, token), role, ttlHours });
      setCopied(null);
    });

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
  };

  const share = () => {
    if (!link) return;
    const url = `https://t.me/share/url?url=${encodeURIComponent(link.url)}&text=${encodeURIComponent(ru.team.invite.shareText(orgName))}`;
    if (telegram?.openTelegramLink) telegram.openTelegramLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  const toggle = (member: Member) => {
    if (member.status === 'disabled') return void run(() => setMemberStatus(member.id, 'active'));
    if (confirming !== member.id) return setConfirming(member.id);
    setConfirming(null);
    void run(() => setMemberStatus(member.id, 'disabled'));
  };

  return (
    <section className="card" aria-labelledby="team-title">
      <h2 id="team-title" className="section-title">
        {ru.team.title}
      </h2>
      {error && (
        <p className="card-text text-bad" role="alert">
          {error}
        </p>
      )}

      <h3 className="card-subtitle">{ru.team.invite.title}</h3>
      <div className="form-row">
        <label className="field">
          <span>{ru.team.invite.role}</span>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as InvitableRole)}>
            {invitableRoles.map((r) => (
              <option key={r} value={r}>
                {ru.roles[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{ru.team.invite.ttl}</span>
          <select className="input" value={ttlHours} onChange={(e) => setTtlHours(Number(e.target.value))}>
            {inviteTtlHours.map((h) => (
              <option key={h} value={h}>
                {ru.team.invite.ttlOption(h)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button type="button" className="button" disabled={busy} onClick={() => void create()}>
        {ru.team.invite.create}
      </button>

      {link && (
        <div className="invite-link" role="status">
          <p className="card-text">{ru.team.invite.ready(ru.roles[link.role], ru.team.invite.ttlOption(link.ttlHours))}</p>
          <input
            className="input"
            readOnly
            value={link.url}
            aria-label={ru.team.invite.linkLabel}
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="banner-actions">
            <button type="button" className="button" onClick={share}>
              {ru.team.invite.share}
            </button>
            <button type="button" className="button button-quiet" onClick={() => void copy()}>
              {copied === 'ok' ? ru.team.invite.copied : ru.team.invite.copy}
            </button>
          </div>
          {copied === 'fail' && <p className="card-text text-muted">{ru.team.invite.copyFailed}</p>}
        </div>
      )}

      <h3 className="card-subtitle">{ru.team.invites.title}</h3>
      {invites.length === 0 ? (
        <p className="card-text text-muted">{ru.team.invites.empty}</p>
      ) : (
        <ul className="rows">
          {invites.map((invite) => (
            <li key={invite.id} className="row">
              <span>
                {ru.roles[invite.role]} ·{' '}
                {invite.state === 'active'
                  ? ru.team.invites.until(formatShortDateTime(invite.expiresAt))
                  : ru.team.invites.state[invite.state]}
              </span>
              {invite.state === 'active' && (
                <button
                  type="button"
                  className="button button-quiet button-small"
                  disabled={busy}
                  onClick={() => {
                    // Отозвали только что созданную ссылку — убираем её с экрана, чтобы не отправить по ошибке.
                    if (invite.id === invites[0]?.id) setLink(null);
                    void run(() => revokeInvite(invite.id));
                  }}
                >
                  {ru.team.invites.revoke}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 className="card-subtitle">{ru.team.members.title}</h3>
      <p className="card-text text-muted">{ru.team.members.hint}</p>
      <ul className="rows">
        {members.map((member) => (
          <li key={member.id} className="row">
            <span className={member.status === 'disabled' ? 'text-muted' : undefined}>
              {member.fullName ?? ru.account.noName} · {ru.roles[member.role]}
              {member.status === 'disabled' && ` · ${ru.team.members.disabled}`}
            </span>
            {member.userId !== selfId && (
              <button
                type="button"
                className={`button button-small ${member.status === 'active' && confirming !== member.id ? 'button-quiet' : ''}`}
                disabled={busy}
                onClick={() => toggle(member)}
              >
                {member.status === 'disabled'
                  ? ru.team.members.enable
                  : confirming === member.id
                    ? ru.team.members.confirmDisable
                    : ru.team.members.disable}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
