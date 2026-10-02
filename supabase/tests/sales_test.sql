-- КАТ-6: загрузка продаж (только владелец со вторым фактором), «Ходовые товары» и «Подорожало».
-- Исключение с отчётом в конце откатывает вымышленные данные, как в остальных тестах.
do $test$
declare
  owner_id uuid := gen_random_uuid(); owner2_id uuid := gen_random_uuid(); manager_id uuid := gen_random_uuid();
  accountant_id uuid := gen_random_uuid(); staff_id uuid := gen_random_uuid(); outsider_id uuid := gen_random_uuid();
  org_a uuid; org_b uuid;
  x_id uuid := gen_random_uuid(); y_id uuid := gen_random_uuid(); z_id uuid := gen_random_uuid();
  w_id uuid := gen_random_uuid(); v_id uuid := gen_random_uuid(); off_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  result jsonb; first_report bigint; denied boolean; n bigint; args record;
  report text[] := '{}'; checks boolean[] := '{}'; labels text[] := '{}'; idx integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u::text || '@test.invalid', now(), now()
  from unnest(array[owner_id, owner2_id, manager_id, accountant_id, staff_id, outsider_id]) u;
  insert into public.organizations (name) values ('Тест продаж') returning id into org_a;
  insert into public.organizations (name) values ('Чужой магазин продаж') returning id into org_b;
  insert into public.memberships (org_id, user_id, role) values
    (org_a, owner_id, 'owner'), (org_a, owner2_id, 'owner'), (org_a, manager_id, 'manager'),
    (org_a, accountant_id, 'accountant'), (org_a, staff_id, 'staff'), (org_b, outsider_id, 'owner');
  insert into public.products (id, org_id, name, retail_price, active) values
    (x_id, org_a, 'Икс', 100, true), (y_id, org_a, 'Игрек', 200, true), (z_id, org_a, 'Зет', 300, true),
    (w_id, org_a, 'Дубль-вэ', 0, true), (v_id, org_a, 'Вэ', 500, true), (off_id, org_a, 'Снят', 100, false),
    (other_id, org_b, 'Чужой', 100, true);
  insert into public.product_internals (product_id, org_id, purchase_price) values (x_id, org_a, 80), (z_id, org_a, 50);

  -- История цен с понятными датами (в одной транзакции now() у всех строк одинаковый).
  update public.price_history set changed_at = now() - interval '40 days' where product_id in (x_id, z_id, w_id, v_id, other_id);
  update public.price_history set changed_at = now() - interval '10 days' where product_id = y_id;
  update public.products set retail_price = 120 where id = x_id;            -- +20 % к цене до окна
  update public.product_internals set purchase_price = 100 where product_id = x_id; -- закупка +25 %
  update public.products set retail_price = 210 where id = y_id;            -- новый товар: +5 % к первой цене окна
  update public.product_internals set purchase_price = 45 where product_id = z_id;  -- подешевело — не в списке
  update public.products set retail_price = 100 where id = w_id;            -- с нуля — это не подорожание
  update public.products set retail_price = 600 where id = v_id;
  update public.products set retail_price = 150 where id = other_id;          -- чужой магазин
  update public.price_history set changed_at = now() - interval '35 days'
    where product_id = v_id and changed_at > now() - interval '1 day';     -- менялось до окна — не новость

  checks := checks || (not has_function_privilege('anon', 'public.import_sales(uuid,bigint,date,date,jsonb,boolean)', 'EXECUTE'));
  labels := labels || 'guest has no EXECUTE on import_sales'::text;
  checks := checks || (select prosecdef from pg_proc where oid = 'public.import_sales(uuid,bigint,date,date,jsonb,boolean)'::regprocedure);
  labels := labels || 'import_sales checks the role itself (SECURITY DEFINER)'::text;

  perform set_config('role', 'authenticated', true);
  for args in select * from (values (manager_id, 'aal2'), (accountant_id, 'aal2'), (staff_id, 'aal2'),
    (owner_id, 'aal1'), (outsider_id, 'aal2')) v(viewer, aal) loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', args.viewer, 'role', 'authenticated',
      'aal', args.aal, 'user_metadata', jsonb_build_object('role', 'owner'))::text, true);
    denied := false;
    begin perform public.import_sales(org_a, null, date '2026-09-01', date '2026-09-30', '[]', true);
    exception when insufficient_privilege then denied := true; end;
    checks := checks || denied; labels := labels || 'manager/accountant/staff/owner without TOTP/other store cannot upload sales'::text;
  end loop;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  for args in select * from (values
    (null::date, date '2026-09-30', '[]'::jsonb), (date '2026-09-30', date '2026-09-01', '[]'),
    (date '1999-12-31', date '2000-01-31', '[]'), (current_date, current_date + 2, '[]'),
    (date '2025-01-01', date '2026-09-30', '[]'), (date '2026-09-01', date '2026-09-30', '{}'),
    (date '2026-09-01', date '2026-09-30', (select jsonb_agg(jsonb_build_object('product_id', x_id, 'qty', 1)) from generate_series(1, 2001)))
  ) v(p_from, p_to, p_rows) loop
    denied := false;
    begin perform public.import_sales(org_a, null, args.p_from, args.p_to, args.p_rows, false);
    exception when invalid_parameter_value then denied := true; end;
    checks := checks || denied; labels := labels || 'bad period, non-array or oversized batch rejected'::text;
  end loop;

  denied := false;
  begin insert into public.product_sales (report_id, org_id, product_id, qty) values (1, org_a, x_id, 1);
  exception when insufficient_privilege then denied := true; end;
  checks := checks || denied; labels := labels || 'no direct writes to product_sales'::text;

  -- Отчёт в две порции: после первой он незавершён и в «Ходовые» не попадает.
  result := public.import_sales(org_a, null, date '2026-09-01', date '2026-09-30', jsonb_build_array(
    jsonb_build_object('product_id', x_id, 'qty', 5, 'amount', 600),
    jsonb_build_object('product_id', y_id, 'qty', 2.5, 'amount', 1000)), false);
  first_report := (result->>'report')::bigint;
  checks := checks || (first_report is not null and result->>'matched' = '2' and result->>'skipped' = '0');
  labels := labels || 'first batch creates report'::text;
  result := public.catalog_issues(org_a, 'bestsellers');
  checks := checks || (result->>'total' = '0' and result->'sales_period' = 'null'::jsonb);
  labels := labels || 'unfinished report is not used'::text;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner2_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  denied := false;
  begin perform public.import_sales(org_a, first_report, null, null, '[]', true);
  exception when invalid_parameter_value then denied := true; end;
  checks := checks || denied; labels := labels || 'another owner cannot append to someone else''s upload'::text;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  result := public.import_sales(org_a, first_report, null, null, jsonb_build_array(
    jsonb_build_object('product_id', y_id, 'qty', 1, 'amount', 100),
    jsonb_build_object('product_id', z_id, 'qty', 0, 'amount', 0),
    jsonb_build_object('product_id', off_id, 'qty', 10, 'amount', 99999),
    jsonb_build_object('product_id', other_id, 'qty', 3, 'amount', 300),
    jsonb_build_object('product_id', v_id, 'qty', 100000000)), true);
  checks := checks || (result->>'report' = first_report::text and result->>'matched' = '3' and result->>'skipped' = '2');
  labels := labels || 'foreign product and absurd quantity skipped'::text;
  checks := checks || (select qty = 3.5 and amount = 1100 from public.product_sales where report_id = first_report and product_id = y_id);
  labels := labels || 'same product in two batches is summed'::text;

  denied := false;
  begin perform public.import_sales(org_a, first_report, null, null, '[]', true);
  exception when invalid_parameter_value then denied := true; end;
  checks := checks || denied; labels := labels || 'finished report cannot be changed'::text;

  -- Более старый период, загруженный позже, не вытесняет свежий.
  result := public.import_sales(org_a, null, date '2026-08-01', date '2026-08-31',
    jsonb_build_array(jsonb_build_object('product_id', w_id, 'qty', 7)), true);
  checks := checks || (select amount is null from public.product_sales where product_id = w_id);
  labels := labels || 'missing amount stays null'::text;

  result := public.catalog_issues(org_a, 'bestsellers');
  checks := checks || (result->>'total' = '2' and result->'counts'->>'bestsellers' = '2'
    and result->'sales_period' = '{"from":"2026-09-01","to":"2026-09-30"}'::jsonb);
  labels := labels || 'latest period used; zero, inactive excluded'::text;
  checks := checks || (result->'items'->0->>'id' = y_id::text and result->'items'->0->>'amount' = '1100'
    and result->'items'->0->>'qty' = '3.500' and result->'items'->1->>'id' = x_id::text);
  labels := labels || 'ordered by revenue, exact qty and amount'::text;

  -- Повторная загрузка того же периода заменяет прежнюю в отчётах.
  perform public.import_sales(org_a, null, date '2026-09-01', date '2026-09-30',
    jsonb_build_array(jsonb_build_object('product_id', z_id, 'qty', 1, 'amount', 50)), true);
  result := public.catalog_issues(org_a, 'bestsellers');
  checks := checks || (result->>'total' = '1' and result->'items'->0->>'id' = z_id::text);
  labels := labels || 're-upload of the same period wins'::text;

  result := public.catalog_issues(org_a, 'price_rise');
  checks := checks || (result->>'total' = '3' and result->'counts'->>'price_rise' = '2');
  labels := labels || 'price rise: three prices of two products'::text;
  checks := checks || (result->'items'->0->>'id' = x_id::text and result->'items'->0->>'price_kind' = 'purchase'
    and result->'items'->0->>'old_price' = '80' and result->'items'->0->>'new_price' = '100');
  labels := labels || 'biggest rise first: purchase 80 -> 100'::text;
  checks := checks || (result->'items'->1->>'price_kind' = 'retail' and result->'items'->1->>'old_price' = '100'
    and result->'items'->1->>'new_price' = '120' and result->'items'->2->>'id' = y_id::text
    and result->'items'->2->>'old_price' = '200' and result->'items'->2->>'changed_at' is not null);
  labels := labels || 'baseline before window, else first price in window'::text;
  checks := checks || (not result::text like '%' || z_id::text || '%' and not result::text like '%' || w_id::text || '%'
    and not result::text like '%' || v_id::text || '%');
  labels := labels || 'decrease, rise from zero and old change not listed'::text;
  checks := checks || (not result::text like '%' || other_id::text || '%');
  labels := labels || 'other store price rise not listed'::text;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', accountant_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  result := public.catalog_issues(org_a, 'bestsellers');
  checks := checks || (result->>'total' = '1'); labels := labels || 'accountant sees bestsellers'::text;
  select count(*) into n from public.product_sales;
  checks := checks || (n = 6); labels := labels || 'accountant reads sales rows of own store'::text;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', staff_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.product_sales;
  checks := checks || (n = 0 and not exists (select 1 from public.sales_reports));
  labels := labels || 'staff does not see sales'::text;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', outsider_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.product_sales;
  checks := checks || (n = 0); labels := labels || 'other store owner does not see sales'::text;

  for idx in 1..array_length(checks, 1) loop
    report := report || (lpad(idx::text, 2, '0') || ' ' || case when checks[idx] then 'ok ' else 'FAIL ' end || labels[idx]);
  end loop;
  raise exception E'РЕЗУЛЬТАТ (всё откатывается):\n%', array_to_string(report, E'\n');
end
$test$;
