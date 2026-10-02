-- Этап 2: «Закончилось на полке» и поставщики товара — роли, общий список, поставщик в списке без цены,
-- загрузка цен поставщиков из 1С (только с флагом 152-ФЗ). Данные вымышленные; всё откатывается.
do $test$
declare
  owner_id uuid := gen_random_uuid(); manager_id uuid := gen_random_uuid(); accountant_id uuid := gen_random_uuid();
  staff_id uuid := gen_random_uuid(); customer_id uuid := gen_random_uuid(); outsider_id uuid := gen_random_uuid();
  org_a uuid; org_b uuid; milk_id uuid := gen_random_uuid(); bread_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid(); sup_a uuid; sup_b uuid; mark_id uuid; result jsonb; denied boolean; n bigint; args record;
  report text[] := '{}'; checks boolean[] := '{}'; labels text[] := '{}'; idx integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u::text || '@test.invalid', now(), now()
  from unnest(array[owner_id, manager_id, accountant_id, staff_id, customer_id, outsider_id]) u;
  update public.profiles set full_name = 'Тестовый сотрудник' where id = staff_id;
  insert into public.organizations (name) values ('Тест полки') returning id into org_a;
  insert into public.organizations (name) values ('Чужой магазин полки') returning id into org_b;
  insert into public.memberships (org_id, user_id, role) values
    (org_a, owner_id, 'owner'), (org_a, manager_id, 'manager'), (org_a, accountant_id, 'accountant'),
    (org_a, staff_id, 'staff'), (org_a, customer_id, 'customer'), (org_b, outsider_id, 'owner');
  insert into public.products (id, org_id, name, cash_code) values
    (milk_id, org_a, 'Молоко', '11'), (bread_id, org_a, 'Хлеб', '22'), (other_id, org_b, 'Чужой товар', '33');
  insert into public.suppliers (org_id, name) values (org_a, 'ООО Молочный опт') returning id into sup_a;
  insert into public.suppliers (org_id, name) values (org_a, 'ИП Вымышленный пекарь') returning id into sup_b;

  checks := checks || (not has_column_privilege('authenticated', 'public.product_suppliers', 'price', 'INSERT')
    and not has_table_privilege('authenticated', 'public.product_suppliers', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.restock_marks', 'created_by', 'INSERT')
    and not has_table_privilege('anon', 'public.restock_marks', 'SELECT'));
  labels := labels || 'prices and authors are not writable through the API; guest closed'::text;

  perform set_config('role', 'authenticated', true);
  -- Сотрудник без второго фактора отмечает пустую полку; второй раз тот же товар — нельзя.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', staff_id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  insert into public.restock_marks (org_id, product_id) values (org_a, milk_id) returning id into mark_id;
  insert into public.restock_marks (org_id, product_id) values (org_a, bread_id);
  checks := checks || (select created_by = staff_id from public.restock_marks where id = mark_id);
  labels := labels || 'staff marks an empty shelf; author set by server'::text;
  denied := false;
  begin insert into public.restock_marks (org_id, product_id) values (org_a, milk_id); exception when unique_violation then denied := true; end;
  checks := checks || denied; labels := labels || 'same product once while not ordered'::text;
  denied := false;
  begin insert into public.restock_marks (org_id, product_id) values (org_a, other_id); exception when foreign_key_violation then denied := true; end;
  checks := checks || denied; labels := labels || 'product of another store rejected'::text;
  select count(*) into n from public.product_suppliers;
  denied := false;
  begin insert into public.product_suppliers (org_id, product_id, supplier_id) values (org_a, milk_id, sup_a);
  exception when insufficient_privilege then denied := true; end;
  checks := checks || (n = 0 and denied); labels := labels || 'staff neither reads nor links product suppliers'::text;

  -- Покупатель, бухгалтер, чужой владелец — списка не видят и не пишут.
  for args in select * from (values (customer_id, 'aal1'), (accountant_id, 'aal2'), (outsider_id, 'aal2')) v(viewer, aal) loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', args.viewer, 'role', 'authenticated', 'aal', args.aal)::text, true);
    denied := false;
    begin perform public.restock_list(org_a); exception when insufficient_privilege then denied := true; end;
    checks := checks || (denied and not exists (select 1 from public.restock_marks where org_id = org_a));
    labels := labels || 'customer/accountant/other owner have no restock list'::text;
  end loop;

  -- Управляющий привязывает поставщика к товару (без цены); бухгалтер видит связь.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', manager_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  insert into public.product_suppliers (org_id, product_id, supplier_id) values (org_a, milk_id, sup_a);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', accountant_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  checks := checks || (select count(*) = 1 from public.product_suppliers where org_id = org_a);
  labels := labels || 'manager links supplier; accountant reads it'::text;

  -- Список: поставщик виден сотруднику без цен; кто отметил — только управляющему.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', staff_id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  result := public.restock_list(org_a);
  checks := checks || (jsonb_array_length(result) = 2 and result->0->>'supplier_name' = 'ООО Молочный опт'
    and result->0->>'name' = 'Молоко' and result->1->'supplier_name' = 'null'::jsonb and result->0->'who' = 'null'::jsonb
    and not result::text like '%price%');
  labels := labels || 'staff list: supplier name without prices, no colleague names'::text;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', manager_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  result := public.restock_list(org_a);
  checks := checks || (result->0->>'who' = 'Тестовый сотрудник'); labels := labels || 'manager sees who marked'::text;

  -- Заказано: строка остаётся (серым), товар можно отметить снова; через 14 дней заказанное не показывается.
  update public.restock_marks set ordered_at = now() where id = mark_id;
  insert into public.restock_marks (org_id, product_id) values (org_a, milk_id);
  result := public.restock_list(org_a);
  checks := checks || (jsonb_array_length(result) = 3); labels := labels || 'ordered mark stays, product can be marked again'::text;
  perform set_config('role', 'postgres', true);
  update public.restock_marks set ordered_at = now() - interval '15 days' where id = mark_id;
  perform set_config('role', 'authenticated', true);
  result := public.restock_list(org_a);
  checks := checks || (jsonb_array_length(result) = 2); labels := labels || 'ordered more than 14 days ago is hidden'::text;

  -- Цены поставщиков из 1С: на тестовом сервере выключено; на сервере в РФ — только владелец.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  denied := false;
  begin perform public.import_supplier_prices(org_a, '[]'); exception when insufficient_privilege then denied := true; end;
  checks := checks || denied; labels := labels || 'supplier prices import refused on test server'::text;
  perform set_config('role', 'postgres', true);
  insert into private.instance_settings (key, value) values ('real_personal_data', 'true');
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', manager_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  denied := false;
  begin perform public.import_supplier_prices(org_a, '[]'); exception when insufficient_privilege then denied := true; end;
  checks := checks || denied; labels := labels || 'manager cannot import supplier prices'::text;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  result := public.import_supplier_prices(org_a, jsonb_build_array(
    jsonb_build_object('product_id', milk_id, 'supplier', ' ооо молочный опт ', 'price', 8000, 'price_date', '2026-09-01'),
    jsonb_build_object('product_id', milk_id, 'supplier', 'ООО Новый опт', 'price', 7900, 'price_date', '2026-09-02'),
    jsonb_build_object('product_id', bread_id, 'supplier', 'ИП Вымышленный пекарь', 'price', 3000, 'price_date', '2026-09-03'),
    jsonb_build_object('product_id', other_id, 'supplier', 'ООО Чужой', 'price', 1, 'price_date', '2026-09-03')));
  checks := checks || (result = '{"changed": 3, "suppliers": 1}'::jsonb);
  labels := labels || 'import: suppliers found by name, one created, foreign product skipped'::text;
  result := public.import_supplier_prices(org_a, jsonb_build_array(
    jsonb_build_object('product_id', milk_id, 'supplier', 'ООО Молочный опт', 'price', 7000, 'price_date', '2026-08-01')));
  checks := checks || (result->>'changed' = '0' and (select price = 8000 from public.product_suppliers where product_id = milk_id and supplier_id = sup_a));
  labels := labels || 'older price does not overwrite newer'::text;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', staff_id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  result := public.restock_list(org_a);
  checks := checks || (result->0->>'supplier_name' = 'ИП Вымышленный пекарь' and result->1->>'supplier_name' = 'ООО Новый опт');
  labels := labels || 'list groups by supplier with the freshest price'::text;

  perform set_config('role', 'postgres', true);
  checks := checks || (select count(*) >= 3 from public.audit_log where org_id = org_a and entity = 'product_suppliers');
  labels := labels || 'supplier price changes are audited'::text;

  for idx in 1..array_length(checks, 1) loop
    report := report || (lpad(idx::text, 2, '0') || ' ' || case when checks[idx] then 'ok ' else 'FAIL ' end || labels[idx]);
  end loop;
  raise exception E'РЕЗУЛЬТАТ (всё откатывается):\n%', array_to_string(report, E'\n');
end
$test$;
