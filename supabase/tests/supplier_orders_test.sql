-- Этап 2, ПСТ-2: заказы поставщикам — права, переходы состояний, сумма из состава, календарь и просрочка.
-- Главное, что проверяем: сотрудник зала МОЖЕТ оформить заказ и прочитать его, но денег не видит нигде;
-- ТП видит только свой заказ и может только подтвердить его; закрытый заказ не меняется.
-- Данные вымышленные; всё откатывается.
do $test$
declare
  owner_id uuid := gen_random_uuid(); manager_id uuid := gen_random_uuid(); accountant_id uuid := gen_random_uuid();
  staff_id uuid := gen_random_uuid(); rep_id uuid := gen_random_uuid(); customer_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  org_a uuid; org_b uuid;
  milk_id uuid := gen_random_uuid(); bread_id uuid := gen_random_uuid(); cheese_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  sup_a uuid; sup_b uuid; mark_milk uuid; order_a uuid; order_b uuid; order_old uuid; order_rep uuid;
  result jsonb; denied boolean; n bigint; today date;
  report text[] := '{}'; checks boolean[] := '{}'; labels text[] := '{}'; idx integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u::text || '@test.invalid', now(), now()
  from unnest(array[owner_id, manager_id, accountant_id, staff_id, rep_id, customer_id, outsider_id]) u;
  update public.profiles set full_name = 'Пётр Кладовщик' where id = staff_id;
  insert into public.organizations (name) values ('Тест заказов') returning id into org_a;
  insert into public.organizations (name) values ('Чужой магазин заказов') returning id into org_b;
  insert into public.memberships (org_id, user_id, role) values
    (org_a, owner_id, 'owner'), (org_a, manager_id, 'manager'), (org_a, accountant_id, 'accountant'),
    (org_a, staff_id, 'staff'), (org_a, rep_id, 'supplier'), (org_a, customer_id, 'customer'),
    (org_b, outsider_id, 'owner');
  insert into public.products (id, org_id, name, cash_code, unit, is_weighted) values
    (milk_id, org_a, 'Молоко 3,2%', '101', 'pcs', false),
    (bread_id, org_a, 'Хлеб Столовый', '102', 'pcs', false),
    (cheese_id, org_a, 'Сыр Российский', '5940', 'kg', true),
    (other_id, org_b, 'Чужой товар', '900', 'pcs', false);
  insert into public.suppliers (org_id, name) values (org_a, 'ООО Молочный опт') returning id into sup_a;
  insert into public.suppliers (org_id, name) values (org_a, 'ИП Вымышленный пекарь') returning id into sup_b;
  -- ТП привязан к поставщику через свой контакт (так же, как в ПСТ-1).
  insert into public.supplier_contacts (org_id, supplier_id, role, name, user_id)
  values (org_a, sup_a, 'agent', 'Торговый представитель', rep_id);
  -- Закупочные цены: молоко 80 ₽ за штуку, сыр 699,50 ₽ за кг. У хлеба цены этого поставщика нет.
  insert into public.product_suppliers (org_id, product_id, supplier_id, price, price_date) values
    (org_a, milk_id, sup_a, 8000, '2026-10-01'), (org_a, cheese_id, sup_a, 69950, '2026-10-01');
  today := private.org_today(org_a);

  -- Ни одной записи в заказы через API: ни создать, ни поправить, ни удалить, ни цену подставить.
  checks := checks || (not has_table_privilege('authenticated', 'public.supplier_orders', 'INSERT')
    and not has_table_privilege('authenticated', 'public.supplier_orders', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.supplier_orders', 'DELETE')
    and not has_table_privilege('authenticated', 'public.supplier_order_items', 'INSERT')
    and not has_table_privilege('authenticated', 'public.supplier_order_items', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.supplier_order_items', 'DELETE')
    and not has_table_privilege('anon', 'public.supplier_orders', 'SELECT'));
  labels := labels || 'orders are written only by server functions; guest closed'::text;

  perform set_config('role', 'authenticated', true);

  -- ── Сотрудник зала: отмечает пустую полку и оформляет заказ, денег не касается ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', staff_id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  insert into public.restock_marks (org_id, product_id) values (org_a, milk_id) returning id into mark_milk;
  order_a := public.supplier_order_create(org_a, sup_a, today + 2,
    jsonb_build_array(jsonb_build_object('product_id', milk_id, 'qty', 6),
                      jsonb_build_object('product_id', cheese_id, 'qty', 1.5)),
    array[mark_milk], 'Привезти до обеда');
  checks := checks || (order_a is not null);
  labels := labels || 'staff creates an order from the empty-shelf list'::text;
  checks := checks || (select ordered_at is not null from public.restock_marks where id = mark_milk);
  labels := labels || 'the mark is closed by the same action'::text;
  -- Прямого чтения таблиц у сотрудника нет: цены закупки ему закрыты и здесь.
  select count(*) into n from public.supplier_orders;
  checks := checks || (n = 0);
  labels := labels || 'staff cannot read the orders table directly'::text;
  result := public.supplier_order_get(org_a, order_a);
  checks := checks || (result->>'money' = 'false' and result->>'amount' is null
    and result->'items'->0->>'price' is null and result->'items'->0->>'sum' is null
    and jsonb_array_length(result->'items') = 2 and result->>'who' is null);
  labels := labels || 'staff reads the order without any money or author'::text;
  result := public.supplier_orders_list(org_a);
  checks := checks || (result->>'money' = 'false' and result->'orders'->0->>'amount' is null
    and result->'overdue'->>'amount' is null and jsonb_array_length(result->'orders') = 1);
  labels := labels || 'the list hides money from staff too'::text;
  denied := false;
  begin perform public.supplier_order_status_set(org_a, order_a, 'confirmed'); exception when others then denied := true; end;
  checks := checks || denied; labels := labels || 'staff cannot change the order status'::text;
  denied := false;
  begin perform public.supplier_order_items_set(org_a, order_a, jsonb_build_array(jsonb_build_object('product_id', milk_id, 'qty', 1)));
  exception when others then denied := true; end;
  checks := checks || denied; labels := labels || 'staff cannot change the order contents'::text;

  -- ── Владелец: суммы считаются из состава, в том числе по весу ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  result := public.supplier_order_get(org_a, order_a);
  -- 6 × 80,00 = 480,00; 1,5 кг × 699,50 = 1 049,25. Итого 1 529,25 ₽ = 152 925 копеек.
  checks := checks || (result->>'money' = 'true' and (result->>'amount')::bigint = 152925
    and result->>'who' = 'Пётр Кладовщик' and result->>'note' = 'Привезти до обеда');
  labels := labels || 'amount comes from the contents, weight included (152 925)'::text;
  checks := checks || (select (i.price = 8000 and i.unit = 'pcs' and i.cash_code = '101')
    from public.supplier_order_items i where i.order_id = order_a and i.product_id = milk_id);
  labels := labels || 'price, unit and cash code are snapshotted from the catalog'::text;

  -- Товар без цены этого поставщика: заказ оформляется, но об этом сказано честно.
  order_b := public.supplier_order_create(org_a, sup_b, today - 3,
    jsonb_build_array(jsonb_build_object('product_id', bread_id, 'qty', 20)));
  result := public.supplier_order_get(org_a, order_b);
  checks := checks || (result->>'amount' is null and (select price is null from public.supplier_order_items where order_id = order_b));
  labels := labels || 'no known purchase price: the order has no amount, not a wrong one'::text;

  -- Чужой товар в заказ не попадает, пустой заказ не создаётся, повтор товара — одной строкой.
  denied := false;
  begin perform public.supplier_order_create(org_a, sup_a, null, jsonb_build_array(jsonb_build_object('product_id', other_id, 'qty', 1)));
  exception when others then denied := true; end;
  checks := checks || denied; labels := labels || 'a product of another store does not get into the order'::text;
  denied := false;
  begin perform public.supplier_order_create(org_a, sup_a, null, '[]'::jsonb); exception when others then denied := true; end;
  checks := checks || denied; labels := labels || 'an empty order is refused'::text;
  order_old := public.supplier_order_create(org_a, sup_a, today - 1,
    jsonb_build_array(jsonb_build_object('product_id', milk_id, 'qty', 2),
                      jsonb_build_object('product_id', milk_id, 'qty', 5)));
  select count(*) into n from public.supplier_order_items where order_id = order_old;
  checks := checks || (n = 1 and (select qty = 5 from public.supplier_order_items where order_id = order_old));
  labels := labels || 'the same product twice is one line, the larger quantity'::text;

  -- ── Календарь и просрочка ──
  result := public.supplier_orders_list(org_a);
  -- Просрочено два заказа: хлеб (цены нет) и 5 × 80,00 = 400,00. В сумму попадает только то, что с ценой.
  checks := checks || ((result->'overdue'->>'orders')::int = 2 and (result->'overdue'->>'amount')::bigint = 40000);
  labels := labels || 'overdue: two deliveries awaited before today, 400,00 of them priced'::text;
  checks := checks || (select count(*) = 3 from jsonb_array_elements(result->'days'));
  labels := labels || 'the calendar has a row per expected day'::text;
  checks := checks || (select (d->>'amount')::bigint = 152925 from jsonb_array_elements(result->'days') d
    where (d->>'date')::date = today + 2);
  labels := labels || 'the calendar day carries its own sum'::text;

  -- ── Состояния ──
  denied := false;
  begin perform public.supplier_order_status_set(org_a, order_a, 'received'); exception when others then denied := true; end;
  checks := checks || denied; labels := labels || 'a received order needs the actual amount'::text;
  denied := false;
  begin perform public.supplier_order_status_set(org_a, order_a, 'received', 150000); exception when others then denied := true; end;
  checks := checks || denied; labels := labels || 'created cannot jump straight to received'::text;
  perform public.supplier_order_status_set(org_a, order_a, 'confirmed');
  checks := checks || (select status = 'confirmed' and confirmed_at is not null from public.supplier_orders where id = order_a);
  labels := labels || 'owner confirms the order'::text;
  denied := false;
  begin perform public.supplier_order_items_set(org_a, order_a, jsonb_build_array(jsonb_build_object('product_id', milk_id, 'qty', 1)));
  exception when others then denied := true; end;
  checks := checks || denied; labels := labels || 'contents freeze once the order is confirmed'::text;
  perform public.supplier_order_status_set(org_a, order_a, 'received', 151000);
  checks := checks || (select status = 'received' and amount_actual = 151000 and closed_at is not null
    from public.supplier_orders where id = order_a);
  labels := labels || 'receiving records the actual amount'::text;
  denied := false;
  begin perform public.supplier_order_status_set(org_a, order_a, 'cancelled'); exception when others then denied := true; end;
  checks := checks || denied; labels := labels || 'a closed order is not changed again'::text;
  perform public.supplier_order_status_set(org_a, order_old, 'cancelled');
  checks := checks || (select status = 'cancelled' and amount_actual is null from public.supplier_orders where id = order_old);
  labels := labels || 'a wrong order is cancelled, not erased'::text;

  -- ── Бухгалтер: читает всё, не меняет ничего ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', accountant_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  result := public.supplier_orders_list(org_a);
  checks := checks || (result->>'money' = 'true' and jsonb_array_length(result->'orders') = 3);
  labels := labels || 'accountant sees every order with money'::text;
  denied := false;
  begin perform public.supplier_order_create(org_a, sup_a, null, jsonb_build_array(jsonb_build_object('product_id', milk_id, 'qty', 1)));
  exception when others then denied := true; end;
  checks := checks || denied; labels := labels || 'accountant does not create orders'::text;

  -- ── ТП: только свой заказ, и только подтвердить ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  order_rep := public.supplier_order_create(org_a, sup_a, today + 5,
    jsonb_build_array(jsonb_build_object('product_id', milk_id, 'qty', 3)));

  perform set_config('request.jwt.claims', jsonb_build_object('sub', rep_id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  select count(*) into n from public.supplier_orders;
  checks := checks || (n = 3 and not exists (select 1 from public.supplier_orders where id = order_b));
  labels := labels || 'the rep sees only the orders of their own supplier'::text;
  result := public.supplier_orders_list(org_a);
  checks := checks || (result->>'money' = 'false'
    and not exists (select 1 from jsonb_array_elements(result->'orders') o where o->>'id' = order_b::text));
  labels := labels || 'the list gives the rep neither money nor other suppliers'::text;
  denied := false;
  begin perform public.supplier_order_get(org_a, order_b); exception when others then denied := true; end;
  checks := checks || denied; labels := labels || 'another supplier order is closed to the rep'::text;
  denied := false;
  begin perform public.supplier_order_create(org_a, sup_a, null, jsonb_build_array(jsonb_build_object('product_id', milk_id, 'qty', 1)));
  exception when others then denied := true; end;
  checks := checks || denied; labels := labels || 'the rep does not create orders for the store'::text;
  denied := false;
  begin perform public.supplier_order_status_set(org_a, order_rep, 'cancelled'); exception when others then denied := true; end;
  checks := checks || denied; labels := labels || 'the rep cannot cancel an order'::text;
  denied := false;
  begin perform public.supplier_order_status_set(org_a, order_rep, 'confirmed', null, today + 9);
  exception when others then denied := true; end;
  checks := checks || denied; labels := labels || 'the rep cannot move the expected date while confirming'::text;
  perform public.supplier_order_status_set(org_a, order_rep, 'confirmed');
  checks := checks || (select status = 'confirmed' from public.supplier_orders where id = order_rep);
  labels := labels || 'the rep confirms their own order'::text;

  -- ── Покупатель и чужой магазин ──
  perform set_config('request.jwt.claims', jsonb_build_object('sub', customer_id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  denied := false;
  begin perform public.supplier_orders_list(org_a); exception when others then denied := true; end;
  checks := checks || denied; labels := labels || 'a customer has no access to orders'::text;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', outsider_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  denied := false;
  begin perform public.supplier_orders_list(org_a); exception when others then denied := true; end;
  checks := checks || denied; labels := labels || 'another store owner sees nothing here'::text;
  select count(*) into n from public.supplier_orders;
  checks := checks || (n = 0); labels := labels || 'and reads no rows directly either'::text;

  perform set_config('role', 'postgres', true);
  checks := checks || (select count(*) >= 4 from public.audit_log where org_id = org_a and entity = 'supplier_orders');
  labels := labels || 'every change of an order is in the journal'::text;

  for idx in 1..array_length(checks, 1) loop
    report := report || (lpad(idx::text, 2, '0') || ' ' || case when checks[idx] then 'ok ' else 'FAIL ' end || labels[idx]);
  end loop;
  raise exception E'РЕЗУЛЬТАТ (всё откатывается):\n%', array_to_string(report, E'\n');
end
$test$;
