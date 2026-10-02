-- Тест версии каталога (КАТ-8): меняется при любой правке, не меняется без правок, закрытый магазин не выдаёт.
-- Как и остальные: в конце исключение с отчётом, всё откатывается; «FAIL» = ошибка.
do $test$
declare
  org_open uuid; org_closed uuid; g uuid; p uuid; p2 uuid;
  v0 text; v1 text; log text[] := '{}';
  old constant timestamptz := now() - interval '1 day';
  check_s constant text := '%s %s %s';
begin
  insert into public.organizations (name, slug, catalog_public) values ('Открытый', 'ver-open', true) returning id into org_open;
  insert into public.organizations (name, slug, catalog_public) values ('Закрытый', 'ver-closed', false) returning id into org_closed;
  -- Время правки «вчера»: в одной транзакции now() не меняется, а правки в жизни идут разными транзакциями.
  insert into public.product_groups (org_id, name, updated_at) values (org_open, 'Молочные', old) returning id into g;
  insert into public.products (org_id, group_id, name, cash_code, retail_price, updated_at)
    values (org_open, g, 'Молоко', '1', 8900, old) returning id into p;
  insert into public.products (org_id, name, cash_code, updated_at) values (org_open, 'Хлеб', '2', old) returning id into p2;
  insert into public.product_barcodes (product_id, org_id, barcode) values (p, org_open, '4600000000015');
  insert into public.products (org_id, name, cash_code) values (org_closed, 'Секрет', '1');

  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  v0 := public.catalog_version(org_open);
  log := log || format(check_s, '01', case when v0 ~ '^[0-9a-f]{32}(:[0-9a-f]{32}){3}$' then 'ok  ' else 'FAIL' end, 'guest gets open catalog version');
  log := log || format(check_s, '02', case when public.catalog_version(org_open) = v0 then 'ok  ' else 'FAIL' end, 'stable without changes');
  log := log || format(check_s, '03', case when public.catalog_version(org_closed) is null and public.catalog_version(gen_random_uuid()) is null
    then 'ok  ' else 'FAIL' end, 'closed store same as missing (null)');

  perform set_config('role', 'postgres', true);
  update public.products set retail_price = 9500 where id = p;
  perform set_config('role', 'anon', true);
  v1 := public.catalog_version(org_open);
  log := log || format(check_s, '04', case when v1 <> v0 then 'ok  ' else 'FAIL' end, 'price change changes version');

  perform set_config('role', 'postgres', true);
  insert into public.product_barcodes (product_id, org_id, barcode) values (p2, org_open, '4600000000022');
  perform set_config('role', 'anon', true);
  v0 := v1; v1 := public.catalog_version(org_open);
  log := log || format(check_s, '05', case when v1 <> v0 then 'ok  ' else 'FAIL' end, 'new barcode changes version');

  perform set_config('role', 'postgres', true);
  update public.product_groups set name = 'Молоко и сыр' where id = g;
  perform set_config('role', 'anon', true);
  v0 := v1; v1 := public.catalog_version(org_open);
  log := log || format(check_s, '06', case when v1 <> v0 then 'ok  ' else 'FAIL' end, 'group rename changes version');

  perform set_config('role', 'postgres', true);
  update public.products set active = false where id = p2;
  perform set_config('role', 'anon', true);
  v0 := v1; v1 := public.catalog_version(org_open);
  log := log || format(check_s, '07', case when v1 <> v0 then 'ok  ' else 'FAIL' end, 'withdrawn product changes version');

  perform set_config('role', 'postgres', true);
  raise exception E'РЕЗУЛЬТАТ\n%', array_to_string(log, E'\n');
end;
$test$;
