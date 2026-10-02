-- Этап 2, ПСТ-1: справочник поставщиков (ООО или ИП) и их контактов (ТП, бухгалтер, офис).
-- Права (матрица ТЗ, «Поставщики и ТП, контакты»): владелец и управляющий — полный доступ; бухгалтер и сотрудник
-- зала — чтение; ТП — только свой поставщик (после приглашения, ПСТ-7); покупатель и гость — ничего.
-- Удаление мягкое (deleted_at): удалённое видят владелец и управляющий и могут вернуть.
-- 152-ФЗ: имя и телефон ТП — персональные данные. Массовая загрузка контактов из 1С возможна только на сервере,
-- где это явно разрешено (private.instance_settings, ключ real_personal_data) — на тестовом сервере вне РФ выключена.

-- ── Настройки сервера (не магазина): меняются только SQL при развёртывании, через API недоступны ──
create table private.instance_settings (
  key text primary key,
  value jsonb not null
);
revoke all on private.instance_settings from public, anon, authenticated;

create function private.real_data_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select value = 'true'::jsonb from private.instance_settings where key = 'real_personal_data'), false);
$$;
revoke all on function private.real_data_allowed() from public;

-- Что можно на этом сервере — интерфейс показывает предупреждение и прячет загрузку настоящих контактов.
create function public.instance_info() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('real_personal_data', private.real_data_allowed());
$$;
revoke all on function public.instance_info() from public, anon;
grant execute on function public.instance_info() to authenticated;

-- ── Таблицы ──────────────────────────────────────────────────────────

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  kind text check (kind in ('ooo', 'ip', 'other')),
  note text check (char_length(note) <= 2000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, org_id)
);
-- «ООО Ромашка» и « ооо ромашка » — один поставщик (среди не удалённых).
create unique index suppliers_org_name_idx on public.suppliers (org_id, lower(btrim(name))) where deleted_at is null;
create index suppliers_created_by_idx on public.suppliers (created_by);

create table public.supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  supplier_id uuid not null,
  role text not null default 'agent' check (role in ('agent', 'accountant', 'office', 'other')),
  name text check (char_length(btrim(name)) between 1 and 120),
  phone text check (phone ~ '^\+7[3489][0-9]{9}$'),
  brands text check (char_length(brands) <= 500),
  note text check (char_length(note) <= 1000),
  -- Учётная запись ТП после приглашения (ПСТ-7); через API не записывается.
  user_id uuid references auth.users (id) on delete set null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (name is not null or phone is not null),
  foreign key (supplier_id, org_id) references public.suppliers (id, org_id) on delete cascade
);
create index supplier_contacts_supplier_idx on public.supplier_contacts (supplier_id, org_id);
create index supplier_contacts_user_idx on public.supplier_contacts (user_id);
create index supplier_contacts_created_by_idx on public.supplier_contacts (created_by);
-- Один номер у поставщика — один раз: повторная загрузка не задваивает.
create unique index supplier_contacts_phone_idx on public.supplier_contacts (supplier_id, phone)
  where deleted_at is null and phone is not null;

create trigger suppliers_touch before update on public.suppliers for each row execute function private.touch_updated_at();
create trigger supplier_contacts_touch before update on public.supplier_contacts
  for each row execute function private.touch_updated_at();
create trigger suppliers_audit after insert or update or delete on public.suppliers
  for each row execute function private.audit();
create trigger supplier_contacts_audit after insert or update or delete on public.supplier_contacts
  for each row execute function private.audit();

-- Поставщики, к которым привязан вошедший ТП. Отдельная функция: правило RLS одной таблицы не должно читать
-- другую таблицу через её же RLS (иначе правила зацикливаются).
create function private.my_supplier_ids(p_org uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select c.supplier_id from public.supplier_contacts c
  where c.org_id = p_org and c.user_id = (select auth.uid()) and c.deleted_at is null;
$$;
revoke all on function private.my_supplier_ids(uuid) from public;
grant execute on function private.my_supplier_ids(uuid) to authenticated;

-- ── Права ────────────────────────────────────────────────────────────

alter table public.suppliers enable row level security;
alter table public.supplier_contacts enable row level security;
revoke all on public.suppliers, public.supplier_contacts from anon, authenticated;
grant select on public.suppliers, public.supplier_contacts to authenticated;
grant insert (org_id, name, kind, note), update (name, kind, note, deleted_at) on public.suppliers to authenticated;
grant insert (org_id, supplier_id, role, name, phone, brands, note),
  update (role, name, phone, brands, note, deleted_at) on public.supplier_contacts to authenticated;

create policy suppliers_select on public.suppliers for select to authenticated using (
  private.has_role(org_id, array['owner', 'manager']::public.app_role[])
  or (deleted_at is null and private.has_role(org_id, array['accountant', 'staff']::public.app_role[]))
  or (deleted_at is null and private.has_role(org_id, array['supplier']::public.app_role[])
      and id in (select private.my_supplier_ids(org_id)))
);
create policy suppliers_insert on public.suppliers for insert to authenticated
  with check (private.has_role(org_id, array['owner', 'manager']::public.app_role[]));
create policy suppliers_update on public.suppliers for update to authenticated
  using (private.has_role(org_id, array['owner', 'manager']::public.app_role[]))
  with check (private.has_role(org_id, array['owner', 'manager']::public.app_role[]));

create policy supplier_contacts_select on public.supplier_contacts for select to authenticated using (
  private.has_role(org_id, array['owner', 'manager']::public.app_role[])
  or (deleted_at is null and private.has_role(org_id, array['accountant', 'staff']::public.app_role[]))
  or (deleted_at is null and private.has_role(org_id, array['supplier']::public.app_role[])
      and supplier_id in (select private.my_supplier_ids(org_id)))
);
create policy supplier_contacts_insert on public.supplier_contacts for insert to authenticated
  with check (private.has_role(org_id, array['owner', 'manager']::public.app_role[]));
create policy supplier_contacts_update on public.supplier_contacts for update to authenticated
  using (private.has_role(org_id, array['owner', 'manager']::public.app_role[]))
  with check (private.has_role(org_id, array['owner', 'manager']::public.app_role[]));

-- ── Загрузка контактов из 1С (справочник «Контрагенты») ─────────────
-- Строки: [{name, phones: ['+79…']}]. Поставщик ищется по названию (нет — создаётся), каждый номер добавляется
-- контактом «офис», если такого номера у поставщика ещё нет. Номера приходят уже очищенными; неверный формат
-- отклоняет ограничение таблицы. Только владелец и управляющий и только там, где разрешены настоящие данные.
create function public.import_supplier_contacts(p_org uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_suppliers int := 0;
  v_contacts int := 0;
begin
  if not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'Нет прав' using errcode = '42501';
  end if;
  if not private.real_data_allowed() then
    raise exception 'На этом сервере нельзя хранить настоящие контакты (152-ФЗ)' using errcode = '42501',
      hint = 'real_personal_data';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Ожидается массив строк' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Слишком большая порция: не больше 2000 строк' using errcode = '22023';
  end if;

  with src as materialized (
    select distinct on (lower(btrim(x.name))) btrim(x.name) as name, coalesce(x.phones, '[]') as phones
    from jsonb_to_recordset(p_rows) as x(name text, phones jsonb)
    where char_length(btrim(x.name)) between 1 and 160 and jsonb_typeof(coalesce(x.phones, '[]')) = 'array'
    order by lower(btrim(x.name))
  ), created as (
    insert into public.suppliers (org_id, name)
    select p_org, s.name from src s
    where not exists (select 1 from public.suppliers e
      where e.org_id = p_org and e.deleted_at is null and lower(btrim(e.name)) = lower(s.name))
    on conflict do nothing
    returning id, name
  ), targets as (
    select s.phones, coalesce(c.id, e.id) as supplier_id
    from src s
    left join created c on lower(btrim(c.name)) = lower(s.name)
    left join public.suppliers e on e.org_id = p_org and e.deleted_at is null and lower(btrim(e.name)) = lower(s.name)
  ), numbers as (
    select distinct t.supplier_id, p.phone
    from targets t cross join lateral jsonb_array_elements_text(t.phones) as p(phone)
    where t.supplier_id is not null and p.phone ~ '^\+7[3489][0-9]{9}$'
  ), added as (
    insert into public.supplier_contacts (org_id, supplier_id, role, phone)
    select p_org, n.supplier_id, 'office', n.phone from numbers n
    on conflict do nothing
    returning 1
  )
  select (select count(*) from created), (select count(*) from added) into v_suppliers, v_contacts;

  return jsonb_build_object('suppliers', v_suppliers, 'contacts', v_contacts);
end;
$$;

revoke all on function public.import_supplier_contacts(uuid, jsonb) from public, anon;
grant execute on function public.import_supplier_contacts(uuid, jsonb) to authenticated;
