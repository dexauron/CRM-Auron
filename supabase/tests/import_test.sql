-- Тест импорта каталога (КАТ-5): права, повторный импорт без дублей, пустое не стирает, чужое не трогает.
-- Как и остальные: в конце исключение с отчётом, всё откатывается; «FAIL» = ошибка.
do $test$
declare
  o uuid := gen_random_uuid(); st uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  org_a uuid; org_b uuid; g uuid := gen_random_uuid(); foreign_g uuid; foreign_p uuid;
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid();
  res jsonb; n int; v text; log text[] := '{}';
  check_n constant text := '%s %s %s=%s (ожидалось %s)';
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u::text || '@test.local', now(), now()
  from unnest(array[o, st, x]) u;
  insert into public.organizations (name) values ('А') returning id into org_a;
  insert into public.organizations (name) values ('Б') returning id into org_b;
  insert into public.memberships (org_id, user_id, role) values (org_a, o, 'owner'), (org_a, st, 'staff'), (org_b, x, 'owner');
  insert into public.product_groups (org_id, name) values (org_b, 'Чужая группа') returning id into foreign_g;
  insert into public.products (org_id, name, cash_code) values (org_b, 'Чужой товар', 'B1') returning id into foreign_p;

  perform set_config('role', 'authenticated', true);

  -- Сотрудник и владелец без кода — не могут.
  perform set_config('request.jwt.claims', json_build_object('sub', st, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  begin perform public.import_catalog(org_a, '[]', '[{"name":"x"}]'); log := log || '01 FAIL staff imported'::text;
  exception when others then log := log || ('01 ok staff denied: ' || sqlerrm); end;
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  begin perform public.import_catalog(org_a, '[]', '[{"name":"x"}]'); log := log || '02 FAIL owner aal1 imported'::text;
  exception when others then log := log || ('02 ok owner aal1 denied: ' || sqlerrm); end;

  -- Владелец с кодом: первая загрузка.
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  res := public.import_catalog(org_a,
    jsonb_build_array(jsonb_build_object('id', g, 'name', 'Молочные'), jsonb_build_object('id', foreign_g, 'name', 'Захват')),
    jsonb_build_array(
      jsonb_build_object('id', p1, 'cash_code', '100500', 'name', 'Молоко', 'group_id', g, 'retail_price', 8900,
        'in_stock', true, 'arrival_on', '2026-10-01', 'barcodes', jsonb_build_array('4600000000011', 'плохой код')),
      jsonb_build_object('id', p2, 'name', 'Без кода', 'unit', 'kg', 'is_weighted', true),
      jsonb_build_object('cash_code', 'X', 'name', ''),
      jsonb_build_object('cash_code', 'Y', 'name', 'В чужую группу', 'group_id', foreign_g)));
  log := log || format(check_n, '03', case when (res->>'inserted')::int = 3 and (res->>'skipped')::int = 1 then 'ok  ' else 'FAIL' end,
    'first import', res::text, '{inserted 3, skipped 1}');
  -- Чужое владелец первого магазина не видит — читаем правами базы.
  perform set_config('role', 'postgres', true);
  select name into v from public.product_groups where id = foreign_g;
  perform set_config('role', 'authenticated', true);
  log := log || format(check_n, '04', case when v = 'Чужая группа' then 'ok  ' else 'FAIL' end, 'foreign group untouched', v, 'Чужая группа');
  select count(*) into n from public.products where cash_code = 'Y' and group_id is null and org_id = org_a;
  log := log || format(check_n, '05', case when n = 1 then 'ok  ' else 'FAIL' end, 'foreign group not linked', n, 1);
  select count(*) into n from public.product_barcodes where product_id = p1;
  log := log || format(check_n, '06', case when n = 1 then 'ok  ' else 'FAIL' end, 'valid barcode only', n, 1);

  -- Повторный импорт: без дублей; пустое не стирает; новый штрихкод добавляется.
  res := public.import_catalog(org_a, '[]',
    jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid(), 'cash_code', '100500', 'name', 'Молоко 3.2%', 'barcodes', jsonb_build_array('4600000000028')),
      jsonb_build_object('id', p2, 'name', 'Без кода, новое имя')));
  log := log || format(check_n, '07', case when (res->>'inserted')::int = 0 and (res->>'updated')::int = 2 then 'ok  ' else 'FAIL' end,
    'second import', res::text, '{inserted 0, updated 2}');
  select count(*) into n from public.products where org_id = org_a and cash_code = '100500';
  log := log || format(check_n, '08', case when n = 1 then 'ok  ' else 'FAIL' end, 'no duplicate by code', n, 1);
  select format('%s|%s|%s|%s', name, retail_price, (group_id = g)::text, arrival_on) into v from public.products where id = p1;
  log := log || format(check_n, '09', case when v = 'Молоко 3.2%|8900|true|2026-10-01' then 'ok  ' else 'FAIL' end, 'empty fields kept', v, 'Молоко 3.2%|8900|true|2026-10-01');
  select count(*) into n from public.product_barcodes where product_id = p1;
  log := log || format(check_n, '10', case when n = 2 then 'ok  ' else 'FAIL' end, 'barcode added', n, 2);

  -- Чужой товар по id не трогается; в чужой магазин — нельзя.
  res := public.import_catalog(org_a, '[]', jsonb_build_array(jsonb_build_object('id', foreign_p, 'name', 'Захват')));
  perform set_config('role', 'postgres', true);
  select name into v from public.products where id = foreign_p;
  perform set_config('role', 'authenticated', true);
  log := log || format(check_n, '11', case when v = 'Чужой товар' then 'ok  ' else 'FAIL' end, 'foreign product untouched', v, 'Чужой товар');
  begin perform public.import_catalog(org_b, '[]', '[{"name":"x"}]'); log := log || '12 FAIL imported into foreign store'::text;
  exception when others then log := log || ('12 ok foreign store denied: ' || sqlerrm); end;

  -- Слишком большая порция и не массив — отказ.
  begin perform public.import_catalog(org_a, '[]', (select jsonb_agg(jsonb_build_object('name', i)) from generate_series(1, 2001) i));
    log := log || '13 FAIL oversize batch accepted'::text;
  exception when others then log := log || ('13 ok oversize denied: ' || sqlerrm); end;
  begin perform public.import_catalog(org_a, '{}', '[]'); log := log || '14 FAIL object accepted'::text;
  exception when others then log := log || ('14 ok not array denied: ' || sqlerrm); end;

  -- Гость не может вызвать вовсе.
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  begin perform public.import_catalog(org_a, '[]', '[]'); log := log || '15 FAIL anon called import'::text;
  exception when others then log := log || ('15 ok anon denied: ' || sqlerrm); end;

  raise exception E'РЕЗУЛЬТАТ (всё откатывается):\n%', array_to_string(log, E'\n');
end
$test$;
