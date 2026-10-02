-- Версия каталога магазина (КАТ-8). Устройство хранит каталог у себя и скачивает его заново, только если
-- версия изменилась: каталог открывается сразу, работает без сети, а трафик сервера не растёт с каждым входом.
-- Версия — хэш id и времени правки товаров и групп и всех штрихкодов: меняется при любой правке, добавлении,
-- снятии с продажи. Наружу — только хэш, ни одной строки каталога.
-- Доступ проверяется один раз той же функцией, что в правилах RLS каталога (открыт гостям или человек — участник):
-- построчная проверка на 40 тыс. строк стоила бы ~0,5 с на каждый вход, а так ~50 мс.
create function public.catalog_version(p_org uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_org is null or not private.catalog_visible(p_org) then
    return null;
  end if;
  return concat_ws(':',
    (select md5(coalesce(string_agg(p.id::text || p.updated_at::text, ',' order by p.id), ''))
       from public.products p where p.org_id = p_org and p.active),
    (select md5(coalesce(string_agg(g.id::text || g.updated_at::text, ',' order by g.id), ''))
       from public.product_groups g where g.org_id = p_org),
    (select md5(coalesce(string_agg(b.product_id::text || b.barcode, ',' order by b.product_id, b.barcode), ''))
       from public.product_barcodes b where b.org_id = p_org));
end;
$$;

revoke all on function public.catalog_version(uuid) from public;
grant execute on function public.catalog_version(uuid) to anon, authenticated;
