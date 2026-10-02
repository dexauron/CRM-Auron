-- КАТ-6: инструменты каталога. Только чтение, с правами вызывающего и RLS.
-- Деньги в JSON — строки целых копеек: bigint не округляется при разборе JSON в браузере.
create function public.catalog_issues(
  p_org uuid,
  p_kind text default 'missing_price',
  p_offset integer default 0,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not private.has_role(p_org, array['owner', 'manager', 'accountant']::public.app_role[])
    or not exists (select 1 from public.organizations where id = p_org and deleted_at is null) then
    raise exception 'Нет доступа к инструментам каталога' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('missing_price', 'below_cost', 'no_markup', 'duplicate_barcodes')
    or p_offset is null or p_offset < 0 or p_offset > 1000000
    or p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Неверный фильтр или размер страницы' using errcode = '22023';
  end if;

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
  ), issues as materialized (
    select p.*, flag.kind, null::text as barcode, null::bigint as barcode_count
    from base p cross join lateral (values
      ('missing_price', p.retail_price is null or p.retail_price = 0),
      ('below_cost', p.retail_price > 0 and p.purchase_price > p.retail_price),
      ('no_markup', p.retail_price > 0 and p.purchase_price = p.retail_price)
    ) flag(kind, matches)
    where flag.matches
    union all
    select p.*, 'duplicate_barcodes', b.barcode, d.product_count
    from duplicates d join public.product_barcodes b on b.barcode = d.barcode and b.org_id = p_org
    join base p on p.id = b.product_id
  ), page as (
    select * from issues where kind = p_kind
    order by barcode nulls first, name, id
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'counts', (select jsonb_build_object(
      'missing_price', count(*) filter (where kind = 'missing_price'),
      'below_cost', count(*) filter (where kind = 'below_cost'),
      'no_markup', count(*) filter (where kind = 'no_markup'),
      'duplicate_barcodes', count(distinct barcode) filter (where kind = 'duplicate_barcodes')
    ) from issues),
    'total', (select count(*) from issues where kind = p_kind),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'cash_code', cash_code, 'unit', unit,
      'retail_price', retail_price::text, 'purchase_price', purchase_price::text,
      'barcode', barcode, 'barcode_count', barcode_count
    ) order by barcode nulls first, name, id) from page), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.catalog_issues(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.catalog_issues(uuid, text, integer, integer) to authenticated;
