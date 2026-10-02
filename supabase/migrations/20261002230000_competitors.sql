-- КАТ-6: цены конкурентов с датой (по образцу старого каталога, competitors.js).
-- Записывают владелец, управляющий и сотрудник зала (сходил в соседний магазин — записал цену); видят они же и
-- бухгалтер. Покупателю, поставщику и гостю — никогда: это разведка магазина, а не витрина.
-- Автор записи ставится сервером (столбец created_by нельзя передать: права на вставку — только на нужные столбцы).
-- Удалить запись может её автор, а владелец и управляющий — любую. Исправление = удалить и записать заново.
-- В отчётах берётся самая свежая запись по каждому магазину.

create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, org_id)
);
-- «Магнит» и « магнит » — один магазин.
create unique index competitors_org_name_idx on public.competitors (org_id, lower(btrim(name)));
create index competitors_created_by_idx on public.competitors (created_by);

create table public.competitor_prices (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  product_id uuid not null,
  competitor_id uuid not null,
  price bigint not null check (price > 0 and price < 100000000000),
  observed_on date not null default current_date check (observed_on >= date '2000-01-01'),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (product_id, org_id) references public.products (id, org_id) on delete cascade,
  foreign key (competitor_id, org_id) references public.competitors (id, org_id) on delete cascade
);
create index competitor_prices_product_idx on public.competitor_prices (product_id, org_id, observed_on desc);
create index competitor_prices_competitor_idx on public.competitor_prices (competitor_id, org_id);
create index competitor_prices_created_by_idx on public.competitor_prices (created_by);

create trigger competitors_audit after insert or update or delete on public.competitors
  for each row execute function private.audit();
create trigger competitor_prices_audit after insert or update or delete on public.competitor_prices
  for each row execute function private.audit();

alter table public.competitors enable row level security;
alter table public.competitor_prices enable row level security;
revoke all on public.competitors, public.competitor_prices from anon, authenticated;
grant select, delete on public.competitors, public.competitor_prices to authenticated;
grant insert (org_id, name), update (name) on public.competitors to authenticated;
grant insert (org_id, product_id, competitor_id, price, observed_on) on public.competitor_prices to authenticated;

create policy competitors_select on public.competitors for select to authenticated
  using (private.has_role(org_id, array['owner', 'manager', 'accountant', 'staff']::public.app_role[]));
create policy competitors_insert on public.competitors for insert to authenticated
  with check (private.has_role(org_id, array['owner', 'manager', 'staff']::public.app_role[]));
create policy competitors_update on public.competitors for update to authenticated
  using (private.has_role(org_id, array['owner', 'manager']::public.app_role[]))
  with check (private.has_role(org_id, array['owner', 'manager']::public.app_role[]));
create policy competitors_delete on public.competitors for delete to authenticated
  using (private.has_role(org_id, array['owner', 'manager']::public.app_role[]));

create policy competitor_prices_select on public.competitor_prices for select to authenticated
  using (private.has_role(org_id, array['owner', 'manager', 'accountant', 'staff']::public.app_role[]));
-- Дата не из будущего (запас — сутки на часовой пояс).
create policy competitor_prices_insert on public.competitor_prices for insert to authenticated
  with check (private.has_role(org_id, array['owner', 'manager', 'staff']::public.app_role[])
    and observed_on <= current_date + 1);
create policy competitor_prices_delete on public.competitor_prices for delete to authenticated
  using (private.has_role(org_id, array['owner', 'manager']::public.app_role[])
    or (created_by = (select auth.uid()) and private.has_role(org_id, array['staff']::public.app_role[])));

-- Отчёт «Дешевле у конкурентов» в инструментах: товары, у которых свежая цена хотя бы одного конкурента ниже нашей.
create or replace function public.catalog_issues(
  p_org uuid,
  p_kind text default 'missing_price',
  p_offset integer default 0,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
  v_since timestamptz := now() - interval '30 days';
  v_report bigint;
  v_from date;
  v_to date;
begin
  if auth.uid() is null or not private.has_role(p_org, array['owner', 'manager', 'accountant']::public.app_role[])
    or not exists (select 1 from public.organizations where id = p_org and deleted_at is null) then
    raise exception 'Нет доступа к инструментам каталога' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('missing_price', 'below_cost', 'no_markup', 'low_markup', 'duplicate_barcodes', 'price_rise', 'bestsellers', 'competitor_cheaper')
    or p_offset is null or p_offset < 0 or p_offset > 1000000
    or p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Неверный фильтр или размер страницы' using errcode = '22023';
  end if;

  select r.id, r.period_from, r.period_to into v_report, v_from, v_to
  from public.sales_reports r
  where r.org_id = p_org and r.completed_at is not null
  order by r.period_to desc, r.period_from, r.completed_at desc, r.id desc
  limit 1;

  with base as materialized (
    select p.id, p.name, p.cash_code, p.unit, p.retail_price, i.purchase_price
    from public.products p
    left join public.product_internals i on i.product_id = p.id and i.org_id = p.org_id
    where p.org_id = p_org and p.active
  ), duplicates as (
    select b.barcode, count(*) as product_count
    from public.product_barcodes b join base p on p.id = b.product_id
    where b.org_id = p_org
    group by b.barcode having count(*) > 1
  ), recent as (
    select h.product_id, h.kind, max(h.changed_at) as last_at
    from public.price_history h
    where h.org_id = p_org and h.changed_at >= v_since
    group by h.product_id, h.kind
  ), rises as materialized (
    select p.*, r.kind as price_kind, w.price as old_price, c.price as new_price, r.last_at
    from recent r join base p on p.id = r.product_id
    cross join lateral (select case r.kind when 'retail' then p.retail_price else p.purchase_price end as price) c
    -- Точка отсчёта: последняя цена до окна, а если её нет — первая цена внутри окна.
    cross join lateral (
      select h.price from public.price_history h
      where h.product_id = p.id and h.org_id = p_org and h.kind = r.kind and h.price is not null
      order by h.changed_at >= v_since, case when h.changed_at < v_since then h.changed_at end desc nulls last,
        case when h.changed_at < v_since then h.id end desc nulls last, h.changed_at, h.id
      limit 1
    ) w
    where w.price > 0 and c.price > w.price
  ), latest_rivals as (
    -- По каждому магазину-конкуренту — только самая свежая запись: старая цена ничего не значит.
    select distinct on (c.product_id, c.competitor_id) c.product_id, c.competitor_id, c.price, c.observed_on
    from public.competitor_prices c
    where c.org_id = p_org
    order by c.product_id, c.competitor_id, c.observed_on desc, c.id desc
  ), cheaper as materialized (
    select distinct on (p.id) p.*, k.name as rival, x.price as rival_price, x.observed_on
    from latest_rivals x join base p on p.id = x.product_id
    join public.competitors k on k.id = x.competitor_id and k.org_id = p_org
    where p.retail_price > x.price
    order by p.id, x.price, x.observed_on desc, k.name
  ), issues as materialized (
    select p.*, flag.kind, null::text as barcode, null::bigint as barcode_count,
      null::text as price_kind, null::bigint as old_price, null::bigint as new_price, null::timestamptz as changed_at,
      null::numeric as qty, null::bigint as amount, null::text as rival, null::bigint as rival_price,
      null::date as observed_on, flag.sort_key, null::numeric as sort_key2
    from base p cross join lateral (values
      ('missing_price', p.retail_price is null or p.retail_price = 0, null::numeric),
      ('below_cost', p.retail_price > 0 and p.purchase_price > p.retail_price, null),
      ('no_markup', p.retail_price > 0 and p.purchase_price = p.retail_price, null),
      -- «Почти в ноль»: наценка выше нуля, но меньше 5 % (порог старого каталога); сверху — самая маленькая.
      ('low_markup', p.purchase_price > 0 and p.retail_price > p.purchase_price
        and (p.retail_price - p.purchase_price) * 100 < p.purchase_price * 5,
        (p.retail_price - p.purchase_price)::numeric / nullif(p.purchase_price, 0))
    ) flag(kind, matches, sort_key)
    where flag.matches
    union all
    select p.*, 'duplicate_barcodes', b.barcode, d.product_count,
      null, null, null, null, null, null, null, null, null, null, null
    from duplicates d join public.product_barcodes b on b.barcode = d.barcode and b.org_id = p_org
    join base p on p.id = b.product_id
    union all
    select r.id, r.name, r.cash_code, r.unit, r.retail_price, r.purchase_price, 'price_rise', null, null,
      r.price_kind, r.old_price, r.new_price, r.last_at, null, null, null, null, null,
      -((r.new_price - r.old_price)::numeric / r.old_price), null
    from rises r
    union all
    select p.*, 'bestsellers', null, null, null, null, null, null, s.qty, s.amount, null, null, null,
      -coalesce(s.amount, 0)::numeric, -s.qty
    from public.product_sales s join base p on p.id = s.product_id
    where s.report_id = v_report and s.org_id = p_org and s.qty > 0
    union all
    -- Сверху — где у конкурента дешевле всего относительно нашей цены.
    select x.id, x.name, x.cash_code, x.unit, x.retail_price, x.purchase_price, 'competitor_cheaper', null, null,
      null, null, null, null, null, null, x.rival, x.rival_price, x.observed_on,
      -((x.retail_price - x.rival_price)::numeric / x.retail_price), null
    from cheaper x
  ), page as (
    select * from issues where kind = p_kind
    order by sort_key nulls first, sort_key2 nulls first, barcode nulls first, name, id, price_kind
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'counts', (select jsonb_build_object(
      'missing_price', count(*) filter (where kind = 'missing_price'),
      'below_cost', count(*) filter (where kind = 'below_cost'),
      'no_markup', count(*) filter (where kind = 'no_markup'),
      'low_markup', count(*) filter (where kind = 'low_markup'),
      'duplicate_barcodes', count(distinct barcode) filter (where kind = 'duplicate_barcodes'),
      'price_rise', count(distinct id) filter (where kind = 'price_rise'),
      'bestsellers', count(*) filter (where kind = 'bestsellers'),
      'competitor_cheaper', count(*) filter (where kind = 'competitor_cheaper')
    ) from issues),
    'total', (select count(*) from issues where kind = p_kind),
    'sales_period', case when v_report is null then null else jsonb_build_object('from', v_from, 'to', v_to) end,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'cash_code', cash_code, 'unit', unit,
      'retail_price', retail_price::text, 'purchase_price', purchase_price::text,
      'barcode', barcode, 'barcode_count', barcode_count,
      'price_kind', price_kind, 'old_price', old_price::text, 'new_price', new_price::text, 'changed_at', changed_at,
      'qty', qty::text, 'amount', amount::text,
      'rival', rival, 'rival_price', rival_price::text, 'observed_on', observed_on
    ) order by sort_key nulls first, sort_key2 nulls first, barcode nulls first, name, id, price_kind) from page), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.catalog_issues(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.catalog_issues(uuid, text, integer, integer) to authenticated;
