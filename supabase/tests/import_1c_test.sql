-- Тест выгрузок 1С (КАТ-5): закупка и остаток — только владелец с кодом, только свои товары,
-- повтор ничего не переписывает, пустое не стирает; дата поступления не откатывается назад.
-- Как и остальные: в конце исключение с отчётом, всё откатывается; «FAIL» = ошибка.
do $test$
declare
  o uuid := gen_random_uuid(); m uuid := gen_random_uuid(); st uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  org_a uuid; org_b uuid; p1 uuid; p2 uuid; p_b uuid;
  res jsonb; n int; v text; log text[] := '{}';
  check_n constant text := '%s %s %s=%s (ожидалось %s)';
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u::text || '@test.local', now(), now()
  from unnest(array[o, m, st, x]) u;
  insert into public.organizations (name) values ('А') returning id into org_a;
  insert into public.organizations (name) values ('Б') returning id into org_b;
  insert into public.memberships (org_id, user_id, role) values (org_a, o, 'owner'), (org_a, m, 'manager'), (org_a, st, 'staff'), (org_b, x, 'owner');
  insert into public.products (org_id, name, cash_code, arrival_on) values (org_a, 'Молоко', '1', '2026-10-01') returning id into p1;
  insert into public.products (org_id, name, cash_code) values (org_a, 'Сыр', '2') returning id into p2;
  insert into public.products (org_id, name, cash_code) values (org_b, 'Чужой', '1') returning id into p_b;

  perform set_config('role', 'authenticated', true);
  -- Управляющий и сотрудник с кодом, владелец без кода — нельзя.
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  begin perform public.import_internals(org_a, jsonb_build_array(jsonb_build_object('product_id', p1, 'stock', 1)));
    log := log || '01 FAIL manager wrote internals'::text;
  exception when others then log := log || ('01 ok manager denied: ' || sqlerrm); end;
  perform set_config('request.jwt.claims', json_build_object('sub', st, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  begin perform public.import_internals(org_a, jsonb_build_array(jsonb_build_object('product_id', p1, 'stock', 1)));
    log := log || '02 FAIL staff wrote internals'::text;
  exception when others then log := log || ('02 ok staff denied: ' || sqlerrm); end;
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  begin perform public.import_internals(org_a, jsonb_build_array(jsonb_build_object('product_id', p1, 'stock', 1)));
    log := log || '03 FAIL owner aal1 wrote internals'::text;
  exception when others then log := log || ('03 ok owner aal1 denied: ' || sqlerrm); end;

  -- Владелец с кодом: свои товары записаны, чужой пропущен.
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  res := public.import_internals(org_a, jsonb_build_array(
    jsonb_build_object('product_id', p1, 'purchase_price', 6500, 'stock', 12),
    jsonb_build_object('product_id', p2, 'stock', 0),
    jsonb_build_object('product_id', p_b, 'purchase_price', 1, 'stock', 1)));
  log := log || format(check_n, '04', case when res = '{"matched":2,"changed":2,"skipped":1}'::jsonb then 'ok  ' else 'FAIL' end,
    'first import', res::text, '{matched 2, changed 2, skipped 1}');
  select format('%s|%s', (select in_stock from public.products where id = p1), (select in_stock from public.products where id = p2)) into v;
  log := log || format(check_n, '05', case when v = 't|f' then 'ok  ' else 'FAIL' end, 'in_stock synced', v, 't|f');
  perform set_config('role', 'postgres', true);
  select count(*) into n from public.product_internals where product_id = p_b;
  perform set_config('role', 'authenticated', true);
  log := log || format(check_n, '06', case when n = 0 then 'ok  ' else 'FAIL' end, 'foreign product untouched', n, 0);

  -- Повтор без изменений ничего не переписывает; история цен не растёт.
  res := public.import_internals(org_a, jsonb_build_array(jsonb_build_object('product_id', p1, 'purchase_price', 6500, 'stock', 12)));
  log := log || format(check_n, '07', case when (res->>'changed')::int = 0 then 'ok  ' else 'FAIL' end, 'repeat changes nothing', res::text, '{changed 0}');
  select count(*) into n from public.price_history where product_id = p1 and kind = 'purchase';
  log := log || format(check_n, '08', case when n = 1 then 'ok  ' else 'FAIL' end, 'purchase history once', n, 1);

  -- Пустая закупка не стирает; новый остаток записывается.
  res := public.import_internals(org_a, jsonb_build_array(jsonb_build_object('product_id', p1, 'stock', 2.5)));
  select format('%s|%s', purchase_price, stock) into v from public.product_internals where product_id = p1;
  log := log || format(check_n, '09', case when v = '6500|2.500' then 'ok  ' else 'FAIL' end, 'empty keeps, stock updates', v, '6500|2.500');

  -- Дата поступления: старая из файла не откатывает, новая — записывается.
  perform public.import_catalog(org_a, '[]', jsonb_build_array(jsonb_build_object('cash_code', '1', 'name', 'Молоко', 'arrival_on', '2026-09-01')));
  select arrival_on::text into v from public.products where id = p1;
  log := log || format(check_n, '10', case when v = '2026-10-01' then 'ok  ' else 'FAIL' end, 'older arrival ignored', v, '2026-10-01');
  perform public.import_catalog(org_a, '[]', jsonb_build_array(jsonb_build_object('cash_code', '1', 'name', 'Молоко', 'arrival_on', '2026-10-05')));
  select arrival_on::text into v from public.products where id = p1;
  log := log || format(check_n, '11', case when v = '2026-10-05' then 'ok  ' else 'FAIL' end, 'newer arrival saved', v, '2026-10-05');

  -- Не массив и слишком большая порция — отказ.
  begin perform public.import_internals(org_a, '{}'); log := log || '12 FAIL object accepted'::text;
  exception when others then log := log || ('12 ok not array denied: ' || sqlerrm); end;
  begin perform public.import_internals(org_a, (select jsonb_agg(jsonb_build_object('product_id', p1, 'stock', i)) from generate_series(1, 2001) i));
    log := log || '13 FAIL oversize accepted'::text;
  exception when others then log := log || ('13 ok oversize denied: ' || sqlerrm); end;
  -- Чужой магазин — нельзя.
  begin perform public.import_internals(org_b, jsonb_build_array(jsonb_build_object('product_id', p_b, 'stock', 1)));
    log := log || '14 FAIL wrote into foreign store'::text;
  exception when others then log := log || ('14 ok foreign store denied: ' || sqlerrm); end;

  perform set_config('role', 'postgres', true);
  raise exception E'РЕЗУЛЬТАТ\n%', array_to_string(log, E'\n');
end;
$test$;
