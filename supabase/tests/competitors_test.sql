-- КАТ-6: цены конкурентов — кто видит, кто записывает и удаляет; отчёт «Дешевле у конкурентов».
-- Исключение с отчётом в конце откатывает вымышленные данные, как в остальных тестах.
do $test$
declare
  owner_id uuid := gen_random_uuid(); manager_id uuid := gen_random_uuid(); accountant_id uuid := gen_random_uuid();
  staff_id uuid := gen_random_uuid(); staff2_id uuid := gen_random_uuid(); supplier_id uuid := gen_random_uuid();
  customer_id uuid := gen_random_uuid(); outsider_id uuid := gen_random_uuid();
  org_a uuid; org_b uuid; milk_id uuid := gen_random_uuid(); bread_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid(); rival_a uuid; rival_b uuid; rival_other uuid; price_id bigint; staff_price bigint;
  result jsonb; denied boolean; n bigint; args record;
  report text[] := '{}'; checks boolean[] := '{}'; labels text[] := '{}'; idx integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u::text || '@test.invalid', now(), now()
  from unnest(array[owner_id, manager_id, accountant_id, staff_id, staff2_id, supplier_id, customer_id, outsider_id]) u;
  insert into public.organizations (name, catalog_public) values ('Тест конкурентов', true) returning id into org_a;
  insert into public.organizations (name) values ('Чужой магазин конкурентов') returning id into org_b;
  insert into public.memberships (org_id, user_id, role) values
    (org_a, owner_id, 'owner'), (org_a, manager_id, 'manager'), (org_a, accountant_id, 'accountant'),
    (org_a, staff_id, 'staff'), (org_a, staff2_id, 'staff'), (org_a, supplier_id, 'supplier'),
    (org_a, customer_id, 'customer'), (org_b, outsider_id, 'owner');
  insert into public.products (id, org_id, name, retail_price) values
    (milk_id, org_a, 'Молоко', 9000), (bread_id, org_a, 'Хлеб', 5000), (other_id, org_b, 'Чужой товар', 100);
  insert into public.competitors (org_id, name) values (org_b, 'Магазин другого') returning id into rival_other;

  checks := checks || (not has_table_privilege('anon', 'public.competitor_prices', 'SELECT')
    and not has_column_privilege('authenticated', 'public.competitor_prices', 'created_by', 'INSERT')
    and not has_table_privilege('authenticated', 'public.competitor_prices', 'UPDATE'));
  labels := labels || 'guest has no access; author column cannot be sent; prices are not edited in place'::text;

  perform set_config('role', 'authenticated', true);
  -- Сотрудник зала без второго фактора записывает цену.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', staff_id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  insert into public.competitors (org_id, name) values (org_a, 'Магнит') returning id into rival_a;
  insert into public.competitor_prices (org_id, product_id, competitor_id, price, observed_on)
  values (org_a, milk_id, rival_a, 8500, current_date - 3) returning id into staff_price;
  checks := checks || (select created_by = staff_id from public.competitor_prices where id = staff_price);
  labels := labels || 'staff records a price; author set by server'::text;
  denied := false;
  begin insert into public.competitors (org_id, name) values (org_a, '  магнит '); exception when unique_violation then denied := true; end;
  checks := checks || denied; labels := labels || 'same store name in other case and spaces is one store'::text;
  denied := false;
  begin insert into public.competitor_prices (org_id, product_id, competitor_id, price, observed_on)
    values (org_a, milk_id, rival_a, 8000, current_date + 5);
  exception when insufficient_privilege then denied := true; end;
  checks := checks || denied; labels := labels || 'date from the future rejected'::text;
  denied := false;
  begin insert into public.competitor_prices (org_id, product_id, competitor_id, price) values (org_a, milk_id, rival_a, 0);
  exception when check_violation then denied := true; end;
  checks := checks || denied; labels := labels || 'zero price rejected'::text;
  denied := false;
  begin insert into public.competitor_prices (org_id, product_id, competitor_id, price) values (org_a, other_id, rival_a, 100);
  exception when foreign_key_violation then denied := true; end;
  checks := checks || denied; labels := labels || 'product of another store rejected'::text;
  denied := false;
  begin insert into public.competitor_prices (org_id, product_id, competitor_id, price) values (org_a, milk_id, rival_other, 100);
  exception when foreign_key_violation then denied := true; end;
  checks := checks || denied; labels := labels || 'competitor of another store rejected'::text;
  denied := false;
  begin update public.competitors set name = 'Пятёрочка' where id = rival_a;
    get diagnostics n = row_count; denied := n = 0;
  end;
  checks := checks || denied; labels := labels || 'staff cannot rename a store'::text;

  -- Покупатель, поставщик, владелец без кода и чужой владелец не видят и не пишут.
  for args in select * from (values (customer_id, 'aal1'), (supplier_id, 'aal1'), (owner_id, 'aal1'), (outsider_id, 'aal2')) v(viewer, aal) loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', args.viewer, 'role', 'authenticated', 'aal', args.aal,
      'user_metadata', jsonb_build_object('role', 'owner'))::text, true);
    select count(*) into n from public.competitor_prices;
    denied := false;
    begin insert into public.competitor_prices (org_id, product_id, competitor_id, price) values (org_a, milk_id, rival_a, 100);
    exception when insufficient_privilege then denied := true; end;
    checks := checks || (n = 0 and denied and not exists (select 1 from public.competitors where org_id = org_a));
    labels := labels || 'customer/supplier/owner without TOTP/other owner neither read nor write'::text;
  end loop;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', accountant_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.competitor_prices;
  denied := false;
  begin insert into public.competitor_prices (org_id, product_id, competitor_id, price) values (org_a, milk_id, rival_a, 100);
  exception when insufficient_privilege then denied := true; end;
  checks := checks || (n = 1 and denied); labels := labels || 'accountant reads, does not write'::text;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', manager_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  insert into public.competitors (org_id, name) values (org_a, 'Пятёрочка') returning id into rival_b;
  insert into public.competitor_prices (org_id, product_id, competitor_id, price, observed_on) values
    (org_a, milk_id, rival_b, 8800, current_date - 1),
    (org_a, milk_id, rival_a, 9500, current_date - 1),   -- свежая запись «Магнита» дороже нашей
    (org_a, bread_id, rival_b, 4000, current_date - 40),
    (org_a, bread_id, rival_b, 5200, current_date - 2);  -- свежая дороже: старая дешёвая не в счёт
  update public.competitors set name = 'Пятёрочка у рынка' where id = rival_b;
  checks := checks || (select name = 'Пятёрочка у рынка' from public.competitors where id = rival_b);
  labels := labels || 'manager renames a store'::text;

  result := public.catalog_issues(org_a, 'competitor_cheaper');
  checks := checks || (result->>'total' = '1' and result->'counts'->>'competitor_cheaper' = '1'
    and result->'items'->0->>'id' = milk_id::text and result->'items'->0->>'rival' = 'Пятёрочка у рынка'
    and result->'items'->0->>'rival_price' = '8800' and result->'items'->0->>'observed_on' = (current_date - 1)::text);
  labels := labels || 'report: latest price per store, cheapest of them; old cheap record ignored'::text;

  -- Второй сотрудник не удаляет чужую запись, автор — удаляет свою.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', staff2_id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  delete from public.competitor_prices where id = staff_price;
  get diagnostics n = row_count;
  checks := checks || (n = 0); labels := labels || 'staff cannot delete someone else''s record'::text;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', staff_id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  delete from public.competitor_prices where id = staff_price;
  get diagnostics n = row_count;
  checks := checks || (n = 1); labels := labels || 'author deletes own record'::text;
  delete from public.competitors where id = rival_b;
  get diagnostics n = row_count;
  checks := checks || (n = 0); labels := labels || 'staff cannot delete a store'::text;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', manager_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select id into price_id from public.competitor_prices where product_id = bread_id order by observed_on desc limit 1;
  delete from public.competitor_prices where id = price_id;
  get diagnostics n = row_count;
  checks := checks || (n = 1); labels := labels || 'manager deletes any record'::text;
  result := public.catalog_issues(org_a, 'competitor_cheaper');
  checks := checks || (result->>'total' = '2'); labels := labels || 'after deleting the fresh record the older one counts again'::text;

  perform set_config('role', 'postgres', true);
  checks := checks || (select count(*) = 2 from public.audit_log where entity = 'competitor_prices' and action = 'delete' and org_id = org_a);
  labels := labels || 'deletions are in the audit log'::text;

  for idx in 1..array_length(checks, 1) loop
    report := report || (lpad(idx::text, 2, '0') || ' ' || case when checks[idx] then 'ok ' else 'FAIL ' end || labels[idx]);
  end loop;
  raise exception E'РЕЗУЛЬТАТ (всё откатывается):\n%', array_to_string(report, E'\n');
end
$test$;
