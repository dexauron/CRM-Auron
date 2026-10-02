-- Тест прав каталога (КАТ-1, КАТ-4): гость и покупатель не получают закупку и остаток даже прямым запросом.
-- Как и остальные: в конце исключение с отчётом, всё откатывается; «FAIL» = ошибка.
do $test$
declare
  o uuid := gen_random_uuid(); mg uuid := gen_random_uuid(); ac uuid := gen_random_uuid();
  st uuid := gen_random_uuid(); cu uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  org_a uuid; org_b uuid; g uuid; p uuid; p_b uuid; n int; b boolean; log text[] := '{}';
  check_n constant text := '%s %s %s=%s (ожидалось %s)';
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u::text || '@test.local', now(), now()
  from unnest(array[o, mg, ac, st, cu, x]) u;
  insert into public.organizations (name, slug, catalog_public) values ('Открытый', 'test-open', true) returning id into org_a;
  insert into public.organizations (name) values ('Закрытый') returning id into org_b;
  insert into public.memberships (org_id, user_id, role) values
    (org_a, o, 'owner'), (org_a, mg, 'manager'), (org_a, ac, 'accountant'), (org_a, st, 'staff'), (org_a, cu, 'customer');
  insert into public.product_groups (org_id, name) values (org_a, 'Молочные продукты') returning id into g;
  insert into public.products (org_id, group_id, name, cash_code, retail_price) values (org_a, g, 'Молоко 3.2%', '100500', 8900) returning id into p;
  insert into public.product_barcodes (product_id, org_id, barcode) values (p, org_a, '4600000000011');
  insert into public.product_internals (product_id, org_id, purchase_price, stock, note) values (p, org_a, 6500, 12, 'служебное');
  insert into public.products (org_id, name, cash_code) values (org_b, 'Секретный товар', '1') returning id into p_b;

  -- Гость.
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  select count(*) into n from public.organizations where slug = 'test-open';
  log := log || format(check_n, '01', case when n = 1 then 'ok  ' else 'FAIL' end, 'guest finds open store by slug', n, 1);
  select count(*) into n from public.products;
  log := log || format(check_n, '02', case when n = 1 then 'ok  ' else 'FAIL' end, 'guest sees open catalog only', n, 1);
  select in_stock into b from public.products where id = p;
  log := log || format(check_n, '03', case when b then 'ok  ' else 'FAIL' end, 'guest sees in_stock yes/no', b, true);
  select count(*) into n from public.product_barcodes;
  log := log || format(check_n, '04', case when n = 1 then 'ok  ' else 'FAIL' end, 'guest sees barcodes', n, 1);
  begin perform 1 from public.product_internals limit 1; log := log || '05 FAIL guest read internals'::text;
  exception when others then log := log || ('05 ok guest internals denied: ' || sqlerrm); end;
  begin perform 1 from public.price_history limit 1; log := log || '06 FAIL guest read price history'::text;
  exception when others then log := log || ('06 ok guest history denied: ' || sqlerrm); end;
  begin update public.products set retail_price = 1 where id = p; log := log || '07 FAIL guest updated price'::text;
  exception when others then log := log || ('07 ok guest update denied: ' || sqlerrm); end;
  select count(*) into n from information_schema.columns
  where table_schema = 'public' and table_name = 'products' and column_name in ('purchase_price', 'stock', 'note');
  log := log || format(check_n, '08', case when n = 0 then 'ok  ' else 'FAIL' end, 'products has no secret columns', n, 0);

  perform set_config('role', 'authenticated', true);

  -- Покупатель и сотрудник зала: каталог видят, закупку и остаток — нет.
  perform set_config('request.jwt.claims', json_build_object('sub', cu, 'role', 'authenticated')::text, true);
  select count(*) into n from public.product_internals;
  log := log || format(check_n, '09', case when n = 0 then 'ok  ' else 'FAIL' end, 'customer sees internals', n, 0);
  perform set_config('request.jwt.claims', json_build_object('sub', st, 'role', 'authenticated')::text, true);
  select count(*) into n from public.products;
  log := log || format(check_n, '10', case when n = 1 then 'ok  ' else 'FAIL' end, 'staff sees catalog', n, 1);
  select count(*) into n from public.product_internals;
  log := log || format(check_n, '11', case when n = 0 then 'ok  ' else 'FAIL' end, 'staff sees internals', n, 0);
  update public.products set retail_price = 1 where id = p; get diagnostics n = row_count;
  log := log || format(check_n, '12', case when n = 0 then 'ok  ' else 'FAIL' end, 'staff changed price rows', n, 0);

  -- Чужой человек: закрытый магазин не виден.
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into n from public.products where id = p_b;
  log := log || format(check_n, '13', case when n = 0 then 'ok  ' else 'FAIL' end, 'outsider sees closed catalog', n, 0);

  -- Бухгалтер (с кодом): видит закупку, менять не может.
  perform set_config('request.jwt.claims', json_build_object('sub', ac, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.product_internals;
  log := log || format(check_n, '14', case when n = 1 then 'ok  ' else 'FAIL' end, 'accountant sees internals', n, 1);
  update public.product_internals set purchase_price = 1 where product_id = p; get diagnostics n = row_count;
  log := log || format(check_n, '15', case when n = 0 then 'ok  ' else 'FAIL' end, 'accountant changed purchase rows', n, 0);

  -- Бухгалтер без кода не видит закрытое.
  perform set_config('request.jwt.claims', json_build_object('sub', ac, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  select count(*) into n from public.product_internals;
  log := log || format(check_n, '16', case when n = 0 then 'ok  ' else 'FAIL' end, 'accountant aal1 sees internals', n, 0);

  -- Управляющий: меняет цену на полке (история пишется), закупку — нет.
  perform set_config('request.jwt.claims', json_build_object('sub', mg, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  update public.products set retail_price = 9500 where id = p; get diagnostics n = row_count;
  log := log || format(check_n, '17', case when n = 1 then 'ok  ' else 'FAIL' end, 'manager changed retail price', n, 1);
  select count(*) into n from public.price_history where product_id = p and kind = 'retail' and price = 9500;
  log := log || format(check_n, '18', case when n = 1 then 'ok  ' else 'FAIL' end, 'retail change in history', n, 1);
  update public.product_internals set purchase_price = 1 where product_id = p; get diagnostics n = row_count;
  log := log || format(check_n, '19', case when n = 0 then 'ok  ' else 'FAIL' end, 'manager changed purchase rows', n, 0);

  -- Владелец: остаток 0 → «нет в наличии», закупка → история.
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  update public.product_internals set stock = 0, purchase_price = 7000 where product_id = p;
  select in_stock into b from public.products where id = p;
  log := log || format(check_n, '20', case when b = false then 'ok  ' else 'FAIL' end, 'stock 0 → in_stock', b, false);
  select count(*) into n from public.price_history where product_id = p and kind = 'purchase' and price = 7000;
  log := log || format(check_n, '21', case when n = 1 then 'ok  ' else 'FAIL' end, 'purchase change in history', n, 1);
  begin insert into public.product_barcodes (product_id, org_id, barcode) values (p, org_b, '1'); log := log || '22 FAIL barcode with foreign org'::text;
  exception when others then log := log || ('22 ok barcode org must match product: ' || sqlerrm); end;

  -- Владелец без кода: правка каталога не проходит.
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  update public.products set retail_price = 1 where id = p; get diagnostics n = row_count;
  log := log || format(check_n, '23', case when n = 0 then 'ok  ' else 'FAIL' end, 'owner aal1 changed price rows', n, 0);

  -- Неактивный товар гостю не виден.
  perform set_config('role', 'postgres', true);
  update public.products set active = false where id = p;
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  select count(*) into n from public.products;
  log := log || format(check_n, '24', case when n = 0 then 'ok  ' else 'FAIL' end, 'guest sees inactive product', n, 0);

  raise exception E'РЕЗУЛЬТАТ (всё откатывается):\n%', array_to_string(log, E'\n');
end
$test$;
