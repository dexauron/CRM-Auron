-- Этап 0. Ядро: магазины, профили, роли, приглашения, настройки, согласия, журнал, очередь сообщений.
-- Правила: RLS на каждой таблице, по умолчанию всё запрещено; права выдаются явно.
-- Изменение членства и приглашения — только через серверные функции.

-- Служебная схема: не открыта через API, в ней функции для правил доступа и триггеров.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create type public.app_role as enum ('owner', 'manager', 'accountant', 'staff', 'supplier', 'customer');
create type public.member_status as enum ('active', 'disabled');
create type public.consent_kind as enum ('personal_data', 'marketing', 'notifications');

-- ── Таблицы ─────────────────────────────────────────────────────────

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  timezone text not null default 'Europe/Moscow',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Профиль пользователя. Телефон и telegram_id пишет только сервер (из Telegram), не браузер.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  telegram_id bigint unique,
  full_name text check (full_name is null or length(full_name) <= 200),
  phone text check (phone is null or phone ~ '^\+7\d{10}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  status public.member_status not null default 'active',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (org_id, user_id, role)
);
create index memberships_user_active_idx on public.memberships (user_id, org_id) where status = 'active';

-- Приглашение хранит только хэш токена: сам токен показывается владельцу один раз.
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  role public.app_role not null check (role in ('manager', 'accountant', 'staff', 'supplier')),
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
create index invites_org_idx on public.invites (org_id);

create table public.settings (
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_.]{1,64}$'),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, key)
);

-- Согласие = отдельная запись с версией текста; отзыв ставит revoked_at, вернуть нельзя (только новое согласие).
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind public.consent_kind not null,
  text_version text not null check (length(text_version) between 1 and 50),
  given_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index consents_one_active_idx on public.consents (org_id, user_id, kind) where revoked_at is null;

-- Журнал действий: только дописывать (см. триггер ниже).
create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid,
  actor uuid,
  entity text not null,
  entity_id text,
  action text not null,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);
create index audit_log_org_at_idx on public.audit_log (org_id, at desc);

-- Очередь исходящих сообщений. Доступ только у сервера (service_role).
create table public.outbox (
  id bigint generated always as identity primary key,
  org_id uuid references public.organizations (id) on delete cascade,
  channel text not null default 'telegram' check (channel in ('telegram')),
  recipient text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index outbox_pending_idx on public.outbox (next_attempt_at) where status = 'pending';

-- ── Служебные функции ──────────────────────────────────────────────

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Есть ли у текущего пользователя активная роль из списка в этом магазине.
create function private.has_role(p_org uuid, p_roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any (p_roles)
  );
$$;

create function private.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active'
  );
$$;

-- Свой профиль виден всегда. Владелец, управляющий и бухгалтер видят профили людей своего магазина;
-- профили покупателей — только владелец.
create function private.can_view_profile(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user = (select auth.uid()) or exists (
    select 1
    from public.memberships viewer
    join public.memberships target on target.org_id = viewer.org_id
    where viewer.user_id = (select auth.uid())
      and viewer.status = 'active'
      and viewer.role in ('owner', 'manager', 'accountant')
      and target.user_id = p_user
      and (target.role <> 'customer' or viewer.role = 'owner')
  );
$$;

-- Запись в журнал. Хэши токенов в журнал не попадают.
create function private.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_org uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_before := to_jsonb(old) - 'token_hash'; end if;
  if tg_op in ('INSERT', 'UPDATE') then v_after := to_jsonb(new) - 'token_hash'; end if;
  if tg_table_name = 'organizations' then
    v_org := coalesce(v_after ->> 'id', v_before ->> 'id')::uuid;
  else
    v_org := coalesce(v_after ->> 'org_id', v_before ->> 'org_id')::uuid;
  end if;
  insert into public.audit_log (org_id, actor, entity, entity_id, action, before, after)
  values (
    v_org,
    auth.uid(),
    tg_table_name,
    coalesce(v_after ->> 'id', v_before ->> 'id', v_after ->> 'key', v_before ->> 'key'),
    lower(tg_op),
    v_before,
    v_after
  );
  return coalesce(new, old);
end;
$$;

create function private.deny_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_log: только добавление записей';
end;
$$;

-- Профиль создаётся автоматически вместе с пользователем.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.touch_updated_at() from public;
revoke all on function private.audit() from public;
revoke all on function private.deny_change() from public;
revoke all on function private.handle_new_user() from public;
revoke all on function private.has_role(uuid, public.app_role[]) from public;
revoke all on function private.is_member(uuid) from public;
revoke all on function private.can_view_profile(uuid) from public;
grant execute on function private.has_role(uuid, public.app_role[]) to authenticated;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.can_view_profile(uuid) to authenticated;

-- ── Триггеры ───────────────────────────────────────────────────────

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

create trigger organizations_touch before update on public.organizations for each row execute function private.touch_updated_at();
create trigger profiles_touch before update on public.profiles for each row execute function private.touch_updated_at();
create trigger memberships_touch before update on public.memberships for each row execute function private.touch_updated_at();
create trigger settings_touch before update on public.settings for each row execute function private.touch_updated_at();

create trigger organizations_audit after insert or update or delete on public.organizations for each row execute function private.audit();
create trigger profiles_audit after insert or update or delete on public.profiles for each row execute function private.audit();
create trigger memberships_audit after insert or update or delete on public.memberships for each row execute function private.audit();
create trigger invites_audit after insert or update or delete on public.invites for each row execute function private.audit();
create trigger settings_audit after insert or update or delete on public.settings for each row execute function private.audit();
create trigger consents_audit after insert or update or delete on public.consents for each row execute function private.audit();

create trigger audit_log_append_only before update or delete on public.audit_log for each row execute function private.deny_change();
create trigger audit_log_no_truncate before truncate on public.audit_log for each statement execute function private.deny_change();

-- ── Права и правила доступа (RLS) ───────────────────────────────────

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.invites enable row level security;
alter table public.settings enable row level security;
alter table public.consents enable row level security;
alter table public.audit_log enable row level security;
alter table public.outbox enable row level security;

revoke all on public.organizations, public.profiles, public.memberships, public.invites,
  public.settings, public.consents, public.audit_log, public.outbox from anon, authenticated;

-- Магазин видят его участники; менять название может только владелец.
grant select on public.organizations to authenticated;
grant update (name, timezone) on public.organizations to authenticated;
create policy organizations_select on public.organizations for select to authenticated
  using (deleted_at is null and private.is_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (private.has_role(id, array['owner']::public.app_role[]))
  with check (private.has_role(id, array['owner']::public.app_role[]));

-- Профиль: менять можно только своё имя.
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (private.can_view_profile(id));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Членство: только чтение; изменения — через функции ниже.
grant select on public.memberships to authenticated;
create policy memberships_select on public.memberships for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.has_role(org_id, array['owner']::public.app_role[])
    or (role <> 'customer' and private.has_role(org_id, array['manager', 'accountant']::public.app_role[]))
  );

-- Приглашения видит владелец, без хэша токена.
grant select (id, org_id, role, expires_at, used_at, used_by, created_at, created_by) on public.invites to authenticated;
create policy invites_select on public.invites for select to authenticated
  using (private.has_role(org_id, array['owner']::public.app_role[]));

-- Настройки читают сотрудники магазина, меняет владелец.
grant select, insert, update, delete on public.settings to authenticated;
create policy settings_select on public.settings for select to authenticated
  using (private.has_role(org_id, array['owner', 'manager', 'accountant', 'staff']::public.app_role[]));
create policy settings_insert on public.settings for insert to authenticated
  with check (private.has_role(org_id, array['owner']::public.app_role[]));
create policy settings_update on public.settings for update to authenticated
  using (private.has_role(org_id, array['owner']::public.app_role[]))
  with check (private.has_role(org_id, array['owner']::public.app_role[]));
create policy settings_delete on public.settings for delete to authenticated
  using (private.has_role(org_id, array['owner']::public.app_role[]));

-- Согласия: человек видит, даёт и отзывает только свои; владелец видит согласия своего магазина.
grant select on public.consents to authenticated;
grant insert (org_id, user_id, kind, text_version) on public.consents to authenticated;
grant update (revoked_at) on public.consents to authenticated;
create policy consents_select on public.consents for select to authenticated
  using (user_id = (select auth.uid()) or private.has_role(org_id, array['owner']::public.app_role[]));
create policy consents_insert_own on public.consents for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_member(org_id));
create policy consents_revoke_own on public.consents for update to authenticated
  using (user_id = (select auth.uid()) and revoked_at is null)
  with check (user_id = (select auth.uid()) and revoked_at is not null);

-- Журнал читает только владелец своего магазина.
grant select on public.audit_log to authenticated;
create policy audit_log_select on public.audit_log for select to authenticated
  using (org_id is not null and private.has_role(org_id, array['owner']::public.app_role[]));

-- outbox: прав у anon и authenticated нет, правил нет — доступ только у сервера.

-- ── Серверные функции (RPC) ─────────────────────────────────────────

-- Создать приглашение. Возвращает токен один раз; в базе остаётся только хэш.
create function public.create_invite(p_org uuid, p_role public.app_role, p_ttl_hours int default 72)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'Нет прав' using errcode = '42501';
  end if;
  if p_role not in ('manager', 'accountant', 'staff', 'supplier') then
    raise exception 'Эту роль нельзя выдать приглашением' using errcode = '22023';
  end if;
  if p_ttl_hours is null or p_ttl_hours not between 1 and 168 then
    raise exception 'Срок приглашения: от 1 до 168 часов' using errcode = '22023';
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.invites (org_id, role, token_hash, expires_at, created_by)
  values (p_org, p_role, extensions.digest(v_token, 'sha256'), now() + make_interval(hours => p_ttl_hours), auth.uid());
  return v_token;
end;
$$;

-- Принять приглашение: одноразовое, с ограниченным сроком.
create function public.accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.invites;
begin
  if v_uid is null then
    raise exception 'Нужен вход' using errcode = '28000';
  end if;
  select * into v_inv from public.invites
  where token_hash = extensions.digest(coalesce(p_token, ''), 'sha256')
  for update;
  if not found or v_inv.used_at is not null or v_inv.expires_at < now() then
    raise exception 'Приглашение недействительно или истекло' using errcode = '22023';
  end if;
  update public.invites set used_at = now(), used_by = v_uid where id = v_inv.id;
  insert into public.memberships (org_id, user_id, role, created_by)
  values (v_inv.org_id, v_uid, v_inv.role, v_inv.created_by)
  on conflict (org_id, user_id, role) do update set status = 'active';
  return v_inv.org_id;
end;
$$;

-- Включить или отключить участника. Отключённый сразу теряет доступ:
-- права проверяются по базе при каждом запросе, а не по токену.
create function public.set_member_status(p_membership uuid, p_status public.member_status) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership for update;
  if not found or not private.has_role(v_m.org_id, array['owner']::public.app_role[]) then
    raise exception 'Нет прав' using errcode = '42501';
  end if;
  if v_m.role = 'owner' and p_status = 'disabled' and (
    select count(*) from public.memberships
    where org_id = v_m.org_id and role = 'owner' and status = 'active'
  ) <= 1 then
    raise exception 'Нельзя отключить единственного владельца' using errcode = '22023';
  end if;
  update public.memberships set status = p_status where id = p_membership;
end;
$$;

revoke all on function public.create_invite(uuid, public.app_role, int) from public, anon;
revoke all on function public.accept_invite(text) from public, anon;
revoke all on function public.set_member_status(uuid, public.member_status) from public, anon;
grant execute on function public.create_invite(uuid, public.app_role, int) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.set_member_status(uuid, public.member_status) to authenticated;
