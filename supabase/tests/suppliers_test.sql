-- Этап 2, ПСТ-1: справочник поставщиков — роли, мягкое удаление, ТП видит только своего, загрузка из 1С.
-- Данные вымышленные; исключение с отчётом в конце всё откатывает.
do $test$
declare
  owner_id uuid := gen_random_uuid(); manager_id uuid := gen_random_uuid(); accountant_id uuid := gen_random_uuid();
  staff_id uuid := gen_random_uuid(); agent_id uuid := gen_random_uuid(); customer_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  org_a uuid; org_b uuid; sup_a uuid; sup_b uuid; sup_gone uuid; contact_a uuid; result jsonb; denied boolean; n bigint;
  args record; info jsonb;
  report text[] := '{}'; checks boolean[] := '{}'; labels text[] := '{}'; idx integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u::text || '@test.invalid', now(), now()
  from unnest(array[owner_id, manager_id, accountant_id, staff_id, agent_id, customer_id, outsider_id]) u;
  insert into public.organizations (name) values ('Тест поставщиков') returning id into org_a;
  insert into public.organizations (name) values ('Чужой магазин поставщиков') returning id into org_b;
  insert into public.memberships (org_id, user_id, role) values
    (org_a, owner_id, 'owner'), (org_a, manager_id, 'manager'), (org_a, accountant_id, 'accountant'),
    (org_a, staff_id, 'staff'), (org_a, agent_id, 'supplier'), (org_a, customer_id, 'customer'), (org_b, outsider_id, 'owner');

  checks := checks || (not has_column_privilege('authenticated', 'public.supplier_contacts', 'user_id', 'INSERT')
    and not has_column_privilege('authenticated', 'public.supplier_contacts', 'user_id', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.suppliers', 'DELETE')
    and not has_table_privilege('anon', 'public.suppliers', 'SELECT')
    and not has_table_privilege('authenticated', 'private.instance_settings', 'SELECT'));
  labels := labels || 'TP link, hard delete, guest and server settings are closed'::text;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', manager_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  insert into public.suppliers (org_id, name, kind) values (org_a, 'ООО Тестовый опт', 'ooo') returning id into sup_a;
  insert into public.suppliers (org_id, name, kind) values (org_a, 'ИП Вымышленный', 'ip') returning id into sup_b;
  insert into public.suppliers (org_id, name) values (org_a, 'Удалённый поставщик') returning id into sup_gone;
  insert into public.supplier_contacts (org_id, supplier_id, role, name, phone, brands)
    values (org_a, sup_a, 'agent', 'Тестовый ТП', '+79000000001', 'Бренд А, Бренд Б') returning id into contact_a;
  insert into public.supplier_contacts (org_id, supplier_id, role, name, phone)
    values (org_a, sup_b, 'agent', 'Другой ТП', '+79000000002');
  update public.suppliers set deleted_at = now() where id = sup_gone;
  checks := checks || (select count(*) = 3 from public.suppliers where org_id = org_a);
  labels := labels || 'manager creates suppliers and contacts, sees deleted ones'::text;

  denied := false;
  begin insert into public.suppliers (org_id, name) values (org_a, '  ооо тестовый ОПТ '); exception when unique_violation then denied := true; end;
  checks := checks || denied; labels := labels || 'same supplier name in other case is a duplicate'::text;
  insert into public.suppliers (org_id, name) values (org_a, 'удалённый поставщик');
  checks := checks || true; labels := labels || 'name of a deleted supplier can be reused'::text;
  denied := false;
  begin insert into public.supplier_contacts (org_id, supplier_id, phone) values (org_a, sup_a, '89000000003'); exception when check_violation then denied := true; end;
  checks := checks || denied; labels := labels || 'phone only in +7XXXXXXXXXX format'::text;
  denied := false;
  begin insert into public.supplier_contacts (org_id, supplier_id, phone) values (org_a, sup_a, '+79000000001'); exception when unique_violation then denied := true; end;
  checks := checks || denied; labels := labels || 'same phone twice at one supplier rejected'::text;
  denied := false;
  begin insert into public.supplier_contacts (org_id, supplier_id, role) values (org_a, sup_a, 'agent'); exception when check_violation then denied := true; end;
  checks := checks || denied; labels := labels || 'contact without name and phone rejected'::text;

  -- Бухгалтер и сотрудник: только чтение, удалённого не видят.
  for args in select * from (values (accountant_id, 'aal2'), (staff_id, 'aal1')) v(viewer, aal) loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', args.viewer, 'role', 'authenticated', 'aal', args.aal)::text, true);
    select count(*) into n from public.suppliers where org_id = org_a;
    denied := false;
    begin insert into public.suppliers (org_id, name) values (org_a, 'Не должен появиться');
    exception when insufficient_privilege then denied := true; end;
    update public.supplier_contacts set phone = '+79000000009' where id = contact_a;
    checks := checks || (n = 3 and denied and (select count(*) = 2 from public.supplier_contacts where org_id = org_a)
      and not exists (select 1 from public.suppliers where id = sup_gone));
    labels := labels || 'accountant/staff read active only, cannot write'::text;
  end loop;

  -- Покупатель, чужой владелец, владелец без кода: ничего.
  for args in select * from (values (customer_id, 'aal1'), (outsider_id, 'aal2'), (owner_id, 'aal1')) v(viewer, aal) loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', args.viewer, 'role', 'authenticated', 'aal', args.aal,
      'user_metadata', jsonb_build_object('role', 'owner'))::text, true);
    checks := checks || (not exists (select 1 from public.suppliers where org_id = org_a)
      and not exists (select 1 from public.supplier_contacts where org_id = org_a));
    labels := labels || 'customer/other owner/owner without TOTP see nothing'::text;
  end loop;

  -- ТП без привязки не видит никого; после привязки — только своего поставщика.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', agent_id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  checks := checks || (not exists (select 1 from public.suppliers where org_id = org_a));
  labels := labels || 'TP without link sees nothing'::text;
  perform set_config('role', 'postgres', true);
  update public.supplier_contacts set user_id = agent_id where id = contact_a;
  perform set_config('role', 'authenticated', true);
  checks := checks || ((select array_agg(id) from public.suppliers where org_id = org_a) = array[sup_a]
    and (select count(*) = 1 from public.supplier_contacts where org_id = org_a));
  labels := labels || 'linked TP sees only own supplier and its contacts'::text;
  update public.supplier_contacts set brands = 'Взлом' where id = contact_a;
  checks := checks || (select brands = 'Бренд А, Бренд Б' from public.supplier_contacts where id = contact_a);
  labels := labels || 'TP cannot edit (for now)'::text;

  -- Загрузка из 1С: выключена, пока на сервере не разрешены настоящие данные.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  info := public.instance_info();
  checks := checks || (info = '{"real_personal_data": false}'::jsonb); labels := labels || 'test server: real data off'::text;
  denied := false;
  begin perform public.import_supplier_contacts(org_a, '[{"name":"Новый","phones":["+79000000005"]}]');
  exception when insufficient_privilege then denied := true; end;
  checks := checks || denied; labels := labels || 'import of contacts refused on test server'::text;

  perform set_config('role', 'postgres', true);
  insert into private.instance_settings (key, value) values ('real_personal_data', 'true');
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', staff_id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  denied := false;
  begin perform public.import_supplier_contacts(org_a, '[]'); exception when insufficient_privilege then denied := true; end;
  checks := checks || denied; labels := labels || 'staff cannot import'::text;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  result := public.import_supplier_contacts(org_a, jsonb_build_array(
    jsonb_build_object('name', ' ооо тестовый опт ', 'phones', jsonb_build_array('+79000000001', '+79000000006')),
    jsonb_build_object('name', 'ООО Новый поставщик', 'phones', jsonb_build_array('+79000000007', 'мусор')),
    jsonb_build_object('name', 'Без телефона', 'phones', '[]'::jsonb),
    jsonb_build_object('name', '', 'phones', jsonb_build_array('+79000000008'))));
  checks := checks || (result = '{"contacts": 2, "suppliers": 2}'::jsonb);
  labels := labels || 'import: existing found by name, new created, known phone skipped, junk dropped'::text;
  result := public.import_supplier_contacts(org_a, jsonb_build_array(
    jsonb_build_object('name', 'ООО Новый поставщик', 'phones', jsonb_build_array('+79000000007'))));
  checks := checks || (result = '{"contacts": 0, "suppliers": 0}'::jsonb); labels := labels || 'repeat import adds nothing'::text;
  checks := checks || (select count(*) = 1 from public.suppliers where org_id = org_a and lower(name) = 'ооо тестовый опт' and deleted_at is null);
  labels := labels || 'no duplicate supplier after import'::text;

  perform set_config('role', 'postgres', true);
  checks := checks || (select count(*) >= 4 from public.audit_log where org_id = org_a and entity = 'supplier_contacts');
  labels := labels || 'contacts changes are audited'::text;

  for idx in 1..array_length(checks, 1) loop
    report := report || (lpad(idx::text, 2, '0') || ' ' || case when checks[idx] then 'ok ' else 'FAIL ' end || labels[idx]);
  end loop;
  raise exception E'РЕЗУЛЬТАТ (всё откатывается):\n%', array_to_string(report, E'\n');
end
$test$;
