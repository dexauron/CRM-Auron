-- КАТ-6: продажи из 1С → «Ходовые товары»; история цен → «Подорожало».
-- 1) Отчёт продаж хранится целиком: загрузка = новая запись sales_reports. Повторная загрузка того же
--    периода ничего не стирает — в отчётах берётся последний ЗАВЕРШЁННЫЙ отчёт. Прерванная загрузка
--    (сеть пропала на середине) остаётся незавершённой и в отчёты не попадает.
-- 2) Загружает только владелец со вторым фактором (как закупку и остатки); видят владелец, управляющий
--    и бухгалтер — те же, кто видит закупку и «Инструменты».
-- 3) catalog_issues получает два вида: price_rise (цена за 30 дней выросла) и bestsellers (продажи за
--    период последнего отчёта, по выручке).

create table public.sales_reports (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  period_from date not null,
  period_to date not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, org_id),
  check (period_from <= period_to)
);
create index sales_reports_org_idx on public.sales_reports (org_id, period_to desc);
create index sales_reports_created_by_idx on public.sales_reports (created_by);

create table public.product_sales (
  report_id bigint not null,
  org_id uuid not null,
  product_id uuid not null,
  qty numeric(14, 3) not null,
  amount bigint,
  primary key (report_id, org_id, product_id),
  foreign key (report_id, org_id) references public.sales_reports (id, org_id) on delete cascade,
  foreign key (product_id, org_id) references public.products (id, org_id) on delete cascade
);
create index product_sales_product_idx on public.product_sales (product_id, org_id);

-- «Что менялось за месяц» — без перебора всей истории магазина.
create index price_history_org_changed_idx on public.price_history (org_id, changed_at);

alter table public.sales_reports enable row level security;
alter table public.product_sales enable row level security;
revoke all on public.sales_reports, public.product_sales from anon, authenticated;
grant select on public.sales_reports, public.product_sales to authenticated;
create policy sales_reports_select on public.sales_reports for select to authenticated
  using (private.has_role(org_id, array['owner', 'manager', 'accountant']::public.app_role[]));
create policy product_sales_select on public.product_sales for select to authenticated
  using (private.has_role(org_id, array['owner', 'manager', 'accountant']::public.app_role[]));

-- Загрузка порциями: первая порция (p_report = null) создаёт отчёт, последняя (p_done) его завершает.
-- Дописывать можно только в свой незавершённый отчёт. Строки чужих товаров пропускаются.
create function public.import_sales(
  p_org uuid,
  p_report bigint,
  p_from date,
  p_to date,
  p_rows jsonb,
  p_done boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_report bigint := p_report;
  v_matched int := 0;
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'Нет прав' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or p_done is null then
    raise exception 'Ожидается массив строк' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Слишком большая порция: не больше 2000 строк' using errcode = '22023';
  end if;

  if v_report is null then
    if p_from is null or p_to is null or p_from > p_to or p_from < date '2000-01-01'
      or p_to > current_date + 1 or p_to - p_from > 400 then
      raise exception 'Неверный период отчёта' using errcode = '22023';
    end if;
    insert into public.sales_reports (org_id, period_from, period_to, created_by)
    values (p_org, p_from, p_to, auth.uid())
    returning id into v_report;
  elsif not exists (
    select 1 from public.sales_reports
    where id = v_report and org_id = p_org and created_by = auth.uid() and completed_at is null
  ) then
    raise exception 'Отчёт продаж не найден или уже загружен' using errcode = '22023';
  end if;

  with src as (
    select x.product_id, sum(x.qty) as qty, sum(x.amount) as amount
    from jsonb_to_recordset(p_rows) as x(product_id uuid, qty numeric, amount bigint)
    join public.products p on p.id = x.product_id and p.org_id = p_org
    where abs(x.qty) < 10000000 and (x.amount is null or abs(x.amount) < 1000000000000000)
    group by x.product_id
  ), ins as (
    insert into public.product_sales (report_id, org_id, product_id, qty, amount)
    select v_report, p_org, product_id, round(qty, 3), amount from src
    on conflict (report_id, org_id, product_id) do update set
      qty = public.product_sales.qty + excluded.qty,
      amount = case when public.product_sales.amount is null and excluded.amount is null then null
        else coalesce(public.product_sales.amount, 0) + coalesce(excluded.amount, 0) end
    returning 1
  )
  select count(*) into v_matched from ins;

  if p_done then
    update public.sales_reports set completed_at = now() where id = v_report;
  end if;

  return jsonb_build_object('report', v_report, 'matched', v_matched,
    'skipped', jsonb_array_length(p_rows) - v_matched);
end;
$$;

revoke all on function public.import_sales(uuid, bigint, date, date, jsonb, boolean) from public, anon;
grant execute on function public.import_sales(uuid, bigint, date, date, jsonb, boolean) to authenticated;

-- Инструменты каталога: прежние четыре проверки без изменений, плюс два отчёта.
-- Теперь SECURITY DEFINER, как catalog_version: права проверяются один раз в начале (та же has_role, что в RLS),
-- а каждый запрос ограничен p_org. С правами вызывающего RLS проверял роль на каждой строке истории цен:
-- на 19 тыс. товаров — 1,8 с на открытие отчёта, так — 0,3 с.
-- price_rise: цена сейчас выше, чем 30 дней назад (или чем первая цена за эти 30 дней, если товар новый);
--   розница и закупка — отдельными строками; сверху то, что подорожало сильнее.
-- bestsellers: товары последнего завершённого отчёта продаж, по выручке, затем по количеству.
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
  if p_kind is null or p_kind not in ('missing_price', 'below_cost', 'no_markup', 'duplicate_barcodes', 'price_rise', 'bestsellers')
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
  ), issues as materialized (
    select p.*, flag.kind, null::text as barcode, null::bigint as barcode_count,
      null::text as price_kind, null::bigint as old_price, null::bigint as new_price, null::timestamptz as changed_at,
      null::numeric as qty, null::bigint as amount, null::numeric as sort_key, null::numeric as sort_key2
    from base p cross join lateral (values
      ('missing_price', p.retail_price is null or p.retail_price = 0),
      ('below_cost', p.retail_price > 0 and p.purchase_price > p.retail_price),
      ('no_markup', p.retail_price > 0 and p.purchase_price = p.retail_price)
    ) flag(kind, matches)
    where flag.matches
    union all
    select p.*, 'duplicate_barcodes', b.barcode, d.product_count,
      null, null, null, null, null, null, null, null
    from duplicates d join public.product_barcodes b on b.barcode = d.barcode and b.org_id = p_org
    join base p on p.id = b.product_id
    union all
    select r.id, r.name, r.cash_code, r.unit, r.retail_price, r.purchase_price, 'price_rise', null, null,
      r.price_kind, r.old_price, r.new_price, r.last_at, null, null,
      -((r.new_price - r.old_price)::numeric / r.old_price), null
    from rises r
    union all
    select p.*, 'bestsellers', null, null, null, null, null, null, s.qty, s.amount,
      -coalesce(s.amount, 0)::numeric, -s.qty
    from public.product_sales s join base p on p.id = s.product_id
    where s.report_id = v_report and s.org_id = p_org and s.qty > 0
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
      'duplicate_barcodes', count(distinct barcode) filter (where kind = 'duplicate_barcodes'),
      'price_rise', count(distinct id) filter (where kind = 'price_rise'),
      'bestsellers', count(*) filter (where kind = 'bestsellers')
    ) from issues),
    'total', (select count(*) from issues where kind = p_kind),
    'sales_period', case when v_report is null then null else jsonb_build_object('from', v_from, 'to', v_to) end,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'cash_code', cash_code, 'unit', unit,
      'retail_price', retail_price::text, 'purchase_price', purchase_price::text,
      'barcode', barcode, 'barcode_count', barcode_count,
      'price_kind', price_kind, 'old_price', old_price::text, 'new_price', new_price::text, 'changed_at', changed_at,
      'qty', qty::text, 'amount', amount::text
    ) order by sort_key nulls first, sort_key2 nulls first, barcode nulls first, name, id, price_kind) from page), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.catalog_issues(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.catalog_issues(uuid, text, integer, integer) to authenticated;
