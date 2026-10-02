-- Импорт каталога (КАТ-5): порция групп и товаров одним вызовом, в одной транзакции.
-- Повторный импорт обновляет товар по коду кассы (без кода — по id) и не создаёт дублей; фото не трогает.
-- Пустое поле в файле не стирает заполненное (цена, группа, дата, наличие). Чужие группы и товары не трогает.
create function public.import_catalog(p_org uuid, p_groups jsonb default '[]', p_products jsonb default '[]')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_groups int := 0;
  v_inserted int := 0;
  v_updated int := 0;
  v_barcodes int := 0;
  v_skipped int := 0;
begin
  if not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'Нет прав' using errcode = '42501';
  end if;
  if jsonb_typeof(p_groups) is distinct from 'array' or jsonb_typeof(p_products) is distinct from 'array' then
    raise exception 'Ожидаются массивы групп и товаров' using errcode = '22023';
  end if;
  if jsonb_array_length(p_groups) > 2000 or jsonb_array_length(p_products) > 2000 then
    raise exception 'Слишком большая порция: не больше 2000 строк' using errcode = '22023';
  end if;

  -- Группы: по id; чужую группу с тем же id не меняем.
  with g as (
    select coalesce(x.id, gen_random_uuid()) as id, btrim(x.name) as name
    from jsonb_to_recordset(p_groups) as x(id uuid, name text)
    where length(btrim(coalesce(x.name, ''))) between 1 and 200
  ), up as (
    insert into public.product_groups (id, org_id, name)
    select id, p_org, name from g
    on conflict (id) do update set name = excluded.name
    where public.product_groups.org_id = p_org
    returning 1
  )
  select count(*) into v_groups from up;

  drop table if exists pg_temp.import_rows;
  create temporary table import_rows on commit drop as
  select
    x.id as given_id,
    nullif(btrim(x.cash_code), '') as cash_code,
    btrim(x.name) as name,
    (select pg.id from public.product_groups pg where pg.id = x.group_id and pg.org_id = p_org) as group_id,
    case when x.unit = 'kg' then 'kg' else 'pcs' end::public.product_unit as unit,
    coalesce(x.is_weighted, false) as is_weighted,
    case when x.retail_price >= 0 then x.retail_price end as retail_price,
    x.in_stock,
    x.arrival_on,
    coalesce(x.barcodes, '{}') as barcodes,
    null::uuid as product_id
  from jsonb_to_recordset(p_products) as x(
    id uuid, cash_code text, name text, group_id uuid, unit text, is_weighted boolean,
    retail_price bigint, in_stock boolean, arrival_on date, barcodes text[]
  );

  delete from pg_temp.import_rows where name is null or length(name) not between 1 and 300 or length(cash_code) > 64;
  get diagnostics v_skipped = row_count;

  -- С кодом кассы: обновляем по коду. Новый товар получает переданный id, если тот свободен.
  with up as (
    insert into public.products (id, org_id, group_id, name, cash_code, unit, is_weighted, retail_price, in_stock, arrival_on)
    select
      case when r.given_id is null or exists (select 1 from public.products p where p.id = r.given_id)
        then gen_random_uuid() else r.given_id end,
      p_org, r.group_id, r.name, r.cash_code, r.unit, r.is_weighted, r.retail_price, r.in_stock, r.arrival_on
    from (select distinct on (cash_code) * from pg_temp.import_rows where cash_code is not null) r
    on conflict (org_id, cash_code) do update set
      name = excluded.name,
      group_id = coalesce(excluded.group_id, public.products.group_id),
      unit = excluded.unit,
      is_weighted = excluded.is_weighted,
      retail_price = coalesce(excluded.retail_price, public.products.retail_price),
      in_stock = coalesce(excluded.in_stock, public.products.in_stock),
      arrival_on = coalesce(excluded.arrival_on, public.products.arrival_on),
      active = true
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted) into v_inserted, v_updated from up;

  update pg_temp.import_rows r set product_id = p.id
  from public.products p where p.org_id = p_org and p.cash_code = r.cash_code and r.cash_code is not null;

  -- Без кода кассы: по id; чужой товар с тем же id не меняем.
  declare
    v_i int;
    v_u int;
  begin
    with up as (
      insert into public.products (id, org_id, group_id, name, unit, is_weighted, retail_price, in_stock, arrival_on)
      select coalesce(r.given_id, gen_random_uuid()), p_org, r.group_id, r.name, r.unit, r.is_weighted, r.retail_price, r.in_stock, r.arrival_on
      from pg_temp.import_rows r where r.cash_code is null
      on conflict (id) do update set
        name = excluded.name,
        group_id = coalesce(excluded.group_id, public.products.group_id),
        unit = excluded.unit,
        is_weighted = excluded.is_weighted,
        retail_price = coalesce(excluded.retail_price, public.products.retail_price),
        in_stock = coalesce(excluded.in_stock, public.products.in_stock),
        arrival_on = coalesce(excluded.arrival_on, public.products.arrival_on),
        active = true
      where public.products.org_id = p_org
      returning (xmax = 0) as inserted
    )
    select count(*) filter (where inserted), count(*) filter (where not inserted) into v_i, v_u from up;
    v_inserted := v_inserted + v_i;
    v_updated := v_updated + v_u;
  end;

  update pg_temp.import_rows r set product_id = r.given_id
  where r.cash_code is null and exists (select 1 from public.products p where p.id = r.given_id and p.org_id = p_org);

  -- Штрихкоды только добавляются: удалить устаревший — отдельным действием, не импортом.
  with b as (
    insert into public.product_barcodes (product_id, org_id, barcode)
    select distinct r.product_id, p_org, btrim(code)
    from pg_temp.import_rows r, unnest(r.barcodes) as code
    where r.product_id is not null and btrim(code) ~ '^[0-9A-Za-z-]{1,64}$'
    on conflict do nothing
    returning 1
  )
  select count(*) into v_barcodes from b;

  return jsonb_build_object('groups', v_groups, 'inserted', v_inserted, 'updated', v_updated,
    'barcodes', v_barcodes, 'skipped', v_skipped);
end;
$$;

revoke all on function public.import_catalog(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.import_catalog(uuid, jsonb, jsonb) to authenticated;
