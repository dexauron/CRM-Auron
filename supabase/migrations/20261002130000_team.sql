-- Команда магазина (СОТ-1): отзыв приглашения и отключение доступа одним действием.

-- Отозвать неиспользованное приглашение: ссылка перестаёт работать сразу.
create function public.revoke_invite(p_invite uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.invites;
begin
  select * into v_inv from public.invites where id = p_invite for update;
  if not found or not private.has_role(v_inv.org_id, array['owner']::public.app_role[]) then
    raise exception 'Нет прав' using errcode = '42501';
  end if;
  if v_inv.used_at is null and v_inv.expires_at > now() then
    update public.invites set expires_at = now() where id = p_invite;
  end if;
end;
$$;

-- Приглашение недействительно с момента expires_at включительно: отозванное «сейчас» уже не принять.
create or replace function public.accept_invite(p_token text) returns uuid
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
  if not found or v_inv.used_at is not null or v_inv.expires_at <= now() then
    raise exception 'Приглашение недействительно или истекло' using errcode = '22023';
  end if;
  update public.invites set used_at = now(), used_by = v_uid where id = v_inv.id;
  insert into public.memberships (org_id, user_id, role, created_by)
  values (v_inv.org_id, v_uid, v_inv.role, v_inv.created_by)
  on conflict (org_id, user_id, role) do update set status = 'active';
  return v_inv.org_id;
end;
$$;

revoke all on function public.revoke_invite(uuid) from public, anon;
grant execute on function public.revoke_invite(uuid) to authenticated;

-- Отключение участника теперь ещё и закрывает все его сессии: токены обновления удаляются
-- (каскадом от auth.sessions), новую сессию без членства он получит, но доступа к магазину в ней нет.
-- Уже выданный токен доступа живёт до часа, но права проверяются по базе при каждом запросе.
create or replace function public.set_member_status(p_membership uuid, p_status public.member_status) returns void
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
  if p_status = 'disabled' then
    delete from auth.sessions where user_id = v_m.user_id;
  end if;
end;
$$;
