-- Этап 2: «Закончилось на полке» (ПСТ-3) и поставщики товара (основа ПСТ-8).
-- 1) product_suppliers — кто поставляет товар и почём (закупка за штуку или кг, из 1С или вручную без цены).
--    Цены закрыты: видят владелец, управляющий, бухгалтер. Связь без цены задают владелец и управляющий; цены
--    приходят только загрузкой «Цен поставщиков» владельцем, и только там, где разрешены настоящие данные
--    (названия ИП — персональные данные, поставщики из 1С создаются по названию).
-- 2) restock_marks — пустая полка: отмечают владелец, управляющий и сотрудник зала (матрица ТЗ: «Задачи,
--    «закончилось на полке»»). Список общий для магазина (в старом каталоге он жил на телефоне и терялся).
--    Заказанное остаётся в списке серым 14 дней, потом не показывается.

create table public.product_suppliers (
  org_id uuid not null,
  product_id uuid not null,
  supplier_id uuid not null,
  price bigint check (price >= 0 and price < 100000000000),
  price_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (product_id, supplier_id),
  foreign key (product_id, org_id) references public.products (id, org_id) on delete cascade,
  foreign key (supplier_id, org_id) references public.suppliers (id, org_id) on delete cascade
);
create index product_suppliers_product_idx on public.product_suppliers (product_id, org_id);
create index product_suppliers_supplier_idx on public.product_suppliers (supplier_id, org_id);
create trigger product_suppliers_touch before update on public.product_suppliers
  for each row execute function private.touch_updated_at();
create trigger product_suppliers_audit after insert or update or delete on public.product_suppliers
  for each row execute function private.audit();

create table public.restock_marks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  product_id uuid not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  ordered_at timestamptz,
  foreign key (product_id, org_id) references public.products (id, org_id) on delete cascade
);
-- Товар в списке один раз, пока не заказан.
create unique index restock_marks_open_idx on public.restock_marks (org_id, product_id) where ordered_at is null;
create index restock_marks_product_idx on public.restock_marks (product_id, org_id);
create index restock_marks_created_by_idx on public.restock_marks (created_by);

alter table public.product_suppliers enable row level security;
alter table public.restock_marks enable row level security;
revoke all on public.product_suppliers, public.restock_marks from anon, authenticated;
grant select, delete on public.product_suppliers, public.restock_marks to authenticated;
grant insert (org_id, product_id, supplier_id) on public.product_suppliers to authenticated;
grant insert (org_id, product_id), update (ordered_at) on public.restock_marks to authenticated;

create policy product_suppliers_select on public.product_suppliers for select to authenticated
  using (private.has_role(org_id, array['owner', 'manager', 'accountant']::public.app_role[]));
create policy product_suppliers_insert on public.product_suppliers for insert to authenticated
  with check (private.has_role(org_id, array['owner', 'manager']::public.app_role[]));
create policy product_suppliers_delete on public.product_suppliers for delete to authenticated
  using (private.has_role(org_id, array['owner', 'manager']::public.app_role[]));

create policy restock_marks_select on public.restock_marks for select to authenticated
  using (private.has_role(org_id, array['owner', 'manager', 'staff']::public.app_role[]));
create policy restock_marks_insert on public.restock_marks for insert to authenticated
  with check (private.has_role(org_id, array['owner', 'manager', 'staff']::public.app_role[]));
create policy restock_marks_update on public.restock_marks for update to authenticated
  using (private.has_role(org_id, array['owner', 'manager', 'staff']::public.app_role[]))
  with check (private.has_role(org_id, array['owner', 'manager', 'staff']::public.app_role[]));
create policy restock_marks_delete on public.restock_marks for delete to authenticated
  using (private.has_role(org_id, array['owner', 'manager', 'staff']::public.app_role[]));

-- Список «Закончилось» с поставщиком каждого товара. Сотруднику зала цены и таблица поставщиков товара закрыты,
-- поэтому функция отдаёт только название поставщика: тот, у кого самая свежая цена (или первый привязанный).
-- Кто отметил — видят только владелец и управляющий (профили сотрудников закрыты от коллег).
create function public.restock_list(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_who boolean;
begin
  if auth.uid() is null or not private.has_role(p_org, array['owner', 'manager', 'staff']::public.app_role[]) then
    raise exception 'Нет доступа к списку' using errcode = '42501';
  end if;
  v_who := private.has_role(p_org, array['owner', 'manager']::public.app_role[]);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'product_id', p.id, 'name', p.name, 'cash_code', p.cash_code, 'unit', p.unit,
      'created_at', m.created_at, 'ordered_at', m.ordered_at,
      'who', case when v_who then pr.full_name end,
      'supplier_id', s.id, 'supplier_name', s.name
    ) order by s.name nulls last, m.ordered_at nulls first, p.name, m.id)
    from public.restock_marks m
    join public.products p on p.id = m.product_id and p.org_id = p_org
    left join public.profiles pr on pr.id = m.created_by
    left join lateral (
      select su.id, su.name from public.product_suppliers ps
      join public.suppliers su on su.id = ps.supplier_id and su.org_id = p_org and su.deleted_at is null
      where ps.product_id = m.product_id and ps.org_id = p_org
      order by ps.price_date desc nulls last, ps.created_at, su.name
      limit 1
    ) s on true
    where m.org_id = p_org and (m.ordered_at is null or m.ordered_at > now() - interval '14 days')
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.restock_list(uuid) from public, anon;
grant execute on function public.restock_list(uuid) to authenticated;

-- Цены поставщиков из 1С: строки [{product_id, supplier, price, price_date}] (цена — копейки за штуку или кг).
-- Поставщик ищется по названию, нет — создаётся. Более старая цена не затирает более свежую.
create function public.import_supplier_prices(p_org uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_suppliers int := 0;
  v_changed int := 0;
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'Нет прав' using errcode = '42501';
  end if;
  if not private.real_data_allowed() then
    raise exception 'На этом сервере нельзя хранить настоящих поставщиков (152-ФЗ)' using errcode = '42501',
      hint = 'real_personal_data';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Ожидается массив строк' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Слишком большая порция: не больше 2000 строк' using errcode = '22023';
  end if;

  with src as materialized (
    select distinct on (x.product_id, lower(btrim(x.supplier))) x.product_id, btrim(x.supplier) as supplier,
      case when x.price >= 0 and x.price < 100000000000 then x.price end as price, x.price_date
    from jsonb_to_recordset(p_rows) as x(product_id uuid, supplier text, price bigint, price_date date)
    join public.products p on p.id = x.product_id and p.org_id = p_org
    where char_length(btrim(x.supplier)) between 1 and 160
    order by x.product_id, lower(btrim(x.supplier)), x.price_date desc nulls last
  ), names as (
    select distinct on (lower(supplier)) supplier from src order by lower(supplier), supplier
  ), created as (
    insert into public.suppliers (org_id, name)
    select p_org, n.supplier from names n
    where not exists (select 1 from public.suppliers e
      where e.org_id = p_org and e.deleted_at is null and lower(btrim(e.name)) = lower(n.supplier))
    on conflict do nothing
    returning id, name
  ), linked as (
    select s.product_id, coalesce(c.id, e.id) as supplier_id, s.price, s.price_date
    from src s
    left join created c on lower(btrim(c.name)) = lower(s.supplier)
    left join public.suppliers e on e.org_id = p_org and e.deleted_at is null and lower(btrim(e.name)) = lower(s.supplier)
  ), up as (
    insert into public.product_suppliers (org_id, product_id, supplier_id, price, price_date)
    select p_org, l.product_id, l.supplier_id, l.price, l.price_date from linked l where l.supplier_id is not null
    on conflict (product_id, supplier_id) do update set price = excluded.price, price_date = excluded.price_date
    where public.product_suppliers.org_id = p_org
      and (public.product_suppliers.price_date is null or excluded.price_date >= public.product_suppliers.price_date)
      and (public.product_suppliers.price, public.product_suppliers.price_date)
        is distinct from (excluded.price, excluded.price_date)
    returning 1
  )
  select (select count(*) from created), (select count(*) from up) into v_suppliers, v_changed;
  return jsonb_build_object('suppliers', v_suppliers, 'changed', v_changed);
end;
$$;
revoke all on function public.import_supplier_prices(uuid, jsonb) from public, anon;
grant execute on function public.import_supplier_prices(uuid, jsonb) to authenticated;
