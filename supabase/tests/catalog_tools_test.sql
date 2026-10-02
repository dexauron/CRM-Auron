-- КАТ-6: серверная фильтрация, точность копеек, все роли, чужой магазин, второй фактор.
-- Исключение с отчётом в конце откатывает вымышленные данные, как в остальных тестах.
do $test$
declare
  owner_id uuid := gen_random_uuid(); manager_id uuid := gen_random_uuid(); accountant_id uuid := gen_random_uuid();
  staff_id uuid := gen_random_uuid(); supplier_id uuid := gen_random_uuid(); customer_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid(); org_a uuid; org_b uuid;
  missing_id uuid := gen_random_uuid(); zero_id uuid := gen_random_uuid(); loss_id uuid := gen_random_uuid();
  equal_id uuid := gen_random_uuid(); good_id uuid := gen_random_uuid(); unknown_id uuid := gen_random_uuid();
  inactive_id uuid := gen_random_uuid(); other_id uuid := gen_random_uuid(); large_id uuid := gen_random_uuid();
  user_id uuid; result jsonb; page_one jsonb; args record; denied boolean; before_count bigint; after_count bigint;
  report text[] := '{}'; checks boolean[] := '{}'; labels text[] := '{}'; idx integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u::text || '@test.invalid', now(), now()
  from unnest(array[owner_id, manager_id, accountant_id, staff_id, supplier_id, customer_id, outsider_id]) u;
  insert into public.organizations (name, catalog_public) values ('Тест инструментов', true) returning id into org_a;
  insert into public.organizations (name, catalog_public) values ('Другой тестовый магазин', true) returning id into org_b;
  insert into public.memberships (org_id, user_id, role) values
    (org_a, owner_id, 'owner'), (org_a, manager_id, 'manager'), (org_a, accountant_id, 'accountant'),
    (org_a, staff_id, 'staff'), (org_a, supplier_id, 'supplier'), (org_a, customer_id, 'customer'), (org_b, outsider_id, 'owner');
  insert into public.products (id, org_id, name, retail_price, active) values
    (missing_id, org_a, 'А без цены', null, true), (zero_id, org_a, 'Б цена ноль', 0, true),
    (loss_id, org_a, 'В дешевле закупки', 9900, true), (equal_id, org_a, 'Г без наценки', 10000, true),
    (good_id, org_a, 'Д наценка одна копейка', 10001, true), (unknown_id, org_a, 'Е закупка неизвестна', 1000, true),
    (inactive_id, org_a, 'Снят с продажи', null, false), (other_id, org_b, 'Чужой товар', null, true),
    (large_id, org_a, 'Ж большое число копеек', 9007199254740992, true);
  insert into public.product_internals (product_id, org_id, purchase_price) values
    (zero_id, org_a, 100), (loss_id, org_a, 10000), (equal_id, org_a, 10000), (good_id, org_a, 10000),
    (large_id, org_a, 9007199254740993);
  insert into public.product_barcodes (product_id, org_id, barcode) values
    (loss_id, org_a, 'DUP-A'), (equal_id, org_a, 'DUP-A'), (good_id, org_a, 'DUP-B'), (equal_id, org_a, 'DUP-B'),
    (missing_id, org_a, 'UNIQUE'), (inactive_id, org_a, 'UNIQUE'), (other_id, org_b, 'DUP-A');
  select count(*) into before_count from public.price_history where org_id = org_a;

  checks := checks || (not has_function_privilege('anon', 'public.catalog_issues(uuid,text,integer,integer)', 'EXECUTE'));
  labels := labels || 'guest has no EXECUTE grant'::text;
  checks := checks || (select not prosecdef from pg_proc where oid = 'public.catalog_issues(uuid,text,integer,integer)'::regprocedure);
  labels := labels || 'function uses SECURITY INVOKER and RLS'::text;

  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  denied := false;
  begin perform public.catalog_issues(org_a); exception when insufficient_privilege then denied := true; end;
  checks := checks || denied; labels := labels || 'guest RPC denied'::text;

  perform set_config('role', 'authenticated', true);
  foreach user_id in array array[staff_id, supplier_id, customer_id, outsider_id] loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', user_id, 'role', 'authenticated', 'aal', 'aal2',
      'user_metadata', jsonb_build_object('role', 'owner'))::text, true);
    denied := false;
    begin perform public.catalog_issues(org_a); exception when insufficient_privilege then denied := true; end;
    checks := checks || denied; labels := labels || 'staff/supplier/customer/other owner denied despite fake metadata'::text;
  end loop;

  foreach user_id in array array[owner_id, manager_id, accountant_id] loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', user_id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    denied := false;
    begin perform public.catalog_issues(org_a); exception when insufficient_privilege then denied := true; end;
    checks := checks || denied; labels := labels || 'privileged role without TOTP denied'::text;

    perform set_config('request.jwt.claims', jsonb_build_object('sub', user_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
    result := public.catalog_issues(org_a);
    checks := checks || (result->'counts' = '{"missing_price":2,"below_cost":2,"no_markup":1,"duplicate_barcodes":2}'::jsonb);
    labels := labels || 'privileged role with TOTP gets correct counts in own store'::text;
  end loop;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  denied := false;
  begin perform public.catalog_issues(org_b); exception when insufficient_privilege then denied := true; end;
  checks := checks || denied; labels := labels || 'owner cannot inspect another public store'::text;

  result := public.catalog_issues(org_a, 'missing_price');
  checks := checks || (result->>'total' = '2' and jsonb_array_length(result->'items') = 2);
  labels := labels || 'null and zero retail prices both missing; inactive excluded'::text;
  checks := checks || ((result->'items'->0->'retail_price') = 'null'::jsonb and result->'items'->1->>'retail_price' = '0');
  labels := labels || 'null differs from zero in JSON'::text;
  result := public.catalog_issues(org_a, 'below_cost');
  checks := checks || (result->>'total' = '2' and not result::text like '%' || zero_id::text || '%');
  labels := labels || 'missing price not counted as below cost'::text;
  checks := checks || (exists (select 1 from jsonb_array_elements(result->'items') item
    where item->>'retail_price' = '9007199254740992' and item->>'purchase_price' = '9007199254740993'));
  labels := labels || 'bigint one-kopeck difference is exact'::text;
  result := public.catalog_issues(org_a, 'no_markup');
  checks := checks || (result->>'total' = '1' and result->'items'->0->>'id' = equal_id::text);
  labels := labels || 'one kopeck markup and unknown purchase not treated as zero markup'::text;
  result := public.catalog_issues(org_a, 'duplicate_barcodes');
  checks := checks || (result->>'total' = '4' and result->'counts'->>'duplicate_barcodes' = '2');
  labels := labels || 'two duplicate codes produce four product/code rows'::text;
  checks := checks || (not exists (select 1 from jsonb_array_elements(result->'items') item where item->>'barcode_count' <> '2'));
  labels := labels || 'foreign store and inactive product excluded from duplicate counts'::text;

  page_one := public.catalog_issues(org_a, 'duplicate_barcodes', 0, 1);
  result := public.catalog_issues(org_a, 'duplicate_barcodes', 1, 1);
  checks := checks || (jsonb_array_length(result->'items') = 1 and result->>'total' = '4'
    and page_one->'items'->0->>'id' <> result->'items'->0->>'id');
  labels := labels || 'stable pagination without repeating rows'::text;
  result := public.catalog_issues(org_a, 'below_cost', 100, 50);
  checks := checks || (result->'items' = '[]'::jsonb and result->>'total' = '2');
  labels := labels || 'empty later page preserves total'::text;

  for args in select * from (values
    (null::text, 0, 50), ('unknown', 0, 50), ('below_cost', -1, 50), ('below_cost', 1000001, 50),
    ('below_cost', null::integer, 50), ('below_cost', 0, null::integer), ('below_cost', 0, 0), ('below_cost', 0, 101)
  ) params(kind, page_offset, page_limit) loop
    denied := false;
    begin perform public.catalog_issues(org_a, args.kind, args.page_offset, args.page_limit);
    exception when invalid_parameter_value then denied := true; end;
    checks := checks || denied; labels := labels || 'invalid filter/pagination rejected'::text;
  end loop;

  perform set_config('role', 'postgres', true);
  select count(*) into after_count from public.price_history where org_id = org_a;
  checks := checks || (before_count = after_count); labels := labels || 'diagnostics do not change prices/history'::text;
  update public.memberships set status = 'disabled' where user_id = owner_id and org_id = org_a;
  perform set_config('role', 'authenticated', true);
  denied := false;
  begin perform public.catalog_issues(org_a); exception when insufficient_privilege then denied := true; end;
  checks := checks || denied; labels := labels || 'disabled owner immediately loses access with old JWT'::text;

  perform set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal2"}', true);
  denied := false;
  begin perform public.catalog_issues(org_a); exception when insufficient_privilege then denied := true; end;
  checks := checks || denied; labels := labels || 'missing auth.uid denied'::text;

  for idx in 1..array_length(checks, 1) loop
    report := report || (lpad(idx::text, 2, '0') || ' ' || case when checks[idx] then 'ok ' else 'FAIL ' end || labels[idx]);
  end loop;
  raise exception E'РЕЗУЛЬТАТ (всё откатывается):\n%', array_to_string(report, E'\n');
end
$test$;
