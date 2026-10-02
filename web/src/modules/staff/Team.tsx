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
import { Avatar } from '../../shared/ui/Avatar';
import { Icon } from '../../shared/ui/icons';
import { Row, RowAction, Section } from '../../shared/ui/List';
import { Segmented } from '../../shared/ui/Segmented';

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

const ttlOptions = inviteTtlHours.map((h) => ({ value: h as number, label: ru.team.invite.ttlOption(h) }));

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

  const revoke = (invite: Invite) => {
    // Отозвали только что созданную ссылку — убираем её с экрана, чтобы не отправить по ошибке.
    if (invite.id === invites[0]?.id) setLink(null);
    void run(() => revokeInvite(invite.id));
  };

  return (
    <>
      {error && (
        <p className="notice tone-bad" role="alert">
          <Icon name="warning" />
          {error}
        </p>
      )}

      <Section title={ru.team.invite.title} id="invite-title" footer={ru.team.invite.footer}>
        <label className="row row-inset-text row-select">
          <span className="row-main">
            <span className="row-title">{ru.team.invite.role}</span>
          </span>
          <span className="row-trailing">
            {ru.roles[role]}
            <Icon name="chevronUpDown" className="row-chevron" />
          </span>
          <select aria-label={ru.team.invite.role} value={role} onChange={(e) => setRole(e.target.value as InvitableRole)}>
            {invitableRoles.map((r) => (
              <option key={r} value={r}>
                {ru.roles[r]}
              </option>
            ))}
          </select>
        </label>
        <div className="row row-inset-text row-stacked">
          <span className="row-title">{ru.team.invite.ttl}</span>
          <Segmented label={ru.team.invite.ttl} options={ttlOptions} value={ttlHours} onChange={setTtlHours} />
        </div>
        <Row title={ru.team.invite.create} tone="link" center onClick={() => void create()} disabled={busy} />
      </Section>

      {link && (
        <Section footer={ru.team.invite.ready(ru.roles[link.role], ru.team.invite.ttlOption(link.ttlHours))}>
          <div className="row row-inset-text" role="status">
            <input
              className="link-field"
              readOnly
              value={link.url}
              aria-label={ru.team.invite.linkLabel}
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
          <Row leading={<Icon name="share" className="row-icon" />} title={ru.team.invite.share} tone="link" onClick={share} />
          <Row
            leading={<Icon name="copy" className="row-icon" />}
            title={copied === 'ok' ? ru.team.invite.copied : ru.team.invite.copy}
            tone="link"
            onClick={() => void copy()}
          />
          {copied === 'fail' && <Row title={ru.team.invite.copyFailed} tone="muted" inset="text" />}
        </Section>
      )}

      <Section title={ru.team.invites.title} id="invites-title">
        {invites.length === 0 ? (
          <Row title={ru.team.invites.empty} tone="muted" />
        ) : (
          invites.map((invite) => (
            <Row
              key={invite.id}
              title={ru.roles[invite.role]}
              subtitle={
                invite.state === 'active'
                  ? ru.team.invites.until(formatShortDateTime(invite.expiresAt))
                  : ru.team.invites.state[invite.state]
              }
              tone={invite.state === 'active' ? 'default' : 'muted'}
              trailing={
                invite.state === 'active' && (
                  <RowAction tone="bad" disabled={busy} onClick={() => revoke(invite)}>
                    {ru.team.invites.revoke}
                  </RowAction>
                )
              }
            />
          ))
        )}
      </Section>

      <Section title={ru.team.members.title} id="members-title" footer={ru.team.members.hint}>
        {members.map((member) => (
          <Row
            key={member.id}
            leading={<Avatar name={member.fullName} />}
            inset="avatar"
            title={member.fullName ?? ru.account.noName}
            subtitle={
              member.status === 'disabled'
                ? `${ru.roles[member.role]} · ${ru.team.members.disabled}`
                : ru.roles[member.role]
            }
            tone={member.status === 'disabled' ? 'muted' : 'default'}
            trailing={
              member.userId !== selfId && (
                <RowAction
                  tone={member.status === 'disabled' ? 'link' : 'bad'}
                  disabled={busy}
                  onClick={() => toggle(member)}
                >
                  {member.status === 'disabled'
                    ? ru.team.members.enable
                    : confirming === member.id
                      ? ru.team.members.confirmDisable
                      : ru.team.members.disable}
                </RowAction>
              )
            }
          />
        ))}
      </Section>
    </>
  );
}
