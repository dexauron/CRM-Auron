-- КАТ-6, сторож наценки: «Почти в ноль» — наценка больше нуля, но меньше 5 %.
-- Порог 5 % взят из старого каталога (margin.js, THIN_PCT): «после расходов магазина это работа в ноль».
-- Наценка считается от закупки, как в старом каталоге и в карточке товара. Остальное в функции без изменений.

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
  if p_kind is null or p_kind not in ('missing_price', 'below_cost', 'no_markup', 'low_markup', 'duplicate_barcodes', 'price_rise', 'bestsellers')
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
      null::numeric as qty, null::bigint as amount, flag.sort_key, null::numeric as sort_key2
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
      'low_markup', count(*) filter (where kind = 'low_markup'),
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
