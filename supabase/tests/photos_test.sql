-- Тест фото товаров (КАТ-7): кто видит, кто добавляет и удаляет записи и файлы в Storage, чужой магазин закрыт.
-- Как и остальные: в конце исключение с отчётом, всё откатывается; «FAIL» = ошибка.
do $test$
declare
  o uuid := gen_random_uuid(); st uuid := gen_random_uuid(); m uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  org_a uuid; org_b uuid; p uuid; p_b uuid; n int; v0 text; v1 text; log text[] := '{}';
  f text; f_b text;
  check_n constant text := '%s %s %s=%s (ожидалось %s)';
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u::text || '@test.local', now(), now()
  from unnest(array[o, st, m, x]) u;
  insert into public.organizations (name, slug, catalog_public) values ('А', 'photos-a', true) returning id into org_a;
  insert into public.organizations (name) values ('Б (закрытый)') returning id into org_b;
  insert into public.memberships (org_id, user_id, role) values (org_a, o, 'owner'), (org_a, st, 'staff'), (org_a, m, 'manager'), (org_b, x, 'owner');
  insert into public.products (org_id, name, cash_code) values (org_a, 'Молоко', '1') returning id into p;
  insert into public.products (org_id, name, cash_code) values (org_b, 'Секрет', '1') returning id into p_b;
  f := org_a || '/' || p || '/abcd1234.jpg';
  f_b := org_b || '/' || p_b || '/abcd1234.jpg';
  insert into public.product_photos (product_id, org_id, path) values (p_b, org_b, f_b);

  perform set_config('role', 'authenticated', true);

  -- Сотрудник и владелец без кода не добавляют ни запись, ни файл.
  perform set_config('request.jwt.claims', json_build_object('sub', st, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  begin insert into public.product_photos (product_id, org_id, path) values (p, org_a, f); log := log || '01 FAIL staff added photo'::text;
  exception when others then log := log || ('01 ok staff denied: ' || sqlerrm); end;
  begin insert into storage.objects (bucket_id, name) values ('product-photos', f); log := log || '02 FAIL staff uploaded file'::text;
  exception when others then log := log || ('02 ok staff upload denied: ' || sqlerrm); end;
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  begin insert into storage.objects (bucket_id, name) values ('product-photos', f); log := log || '03 FAIL owner aal1 uploaded'::text;
  exception when others then log := log || ('03 ok owner aal1 denied: ' || sqlerrm); end;

  -- Управляющий с кодом: файл, уменьшенная копия и запись.
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  insert into storage.objects (bucket_id, name) values ('product-photos', f), ('product-photos', replace(f, '.jpg', '-t.jpg'));
  select count(*) into n from storage.objects where bucket_id = 'product-photos' and name like org_a || '/%';
  log := log || format(check_n, '04', case when n = 2 then 'ok  ' else 'FAIL' end, 'manager uploaded file and thumb', n, 2);
  insert into public.product_photos (product_id, org_id, path) values (p, org_a, f);
  log := log || '05 ok  manager added photo row'::text;

  -- Путь не своего магазина, чужой формат, другой товар в пути — отказ.
  begin insert into storage.objects (bucket_id, name) values ('product-photos', org_b || '/' || p_b || '/zzzz9999.jpg');
    log := log || '06 FAIL uploaded into foreign store folder'::text;
  exception when others then log := log || ('06 ok foreign folder denied: ' || sqlerrm); end;
  begin insert into storage.objects (bucket_id, name) values ('product-photos', 'не-uuid/файл.jpg');
    log := log || '07 FAIL odd path accepted'::text;
  exception when others then log := log || ('07 ok odd path denied: ' || sqlerrm); end;
  begin insert into public.product_photos (product_id, org_id, path) values (p, org_a, org_a || '/' || p_b || '/qwer1234.jpg');
    log := log || '08 FAIL path of other product accepted'::text;
  exception when others then log := log || ('08 ok path must match product: ' || sqlerrm); end;

  -- Гость видит фото открытого каталога и не видит фото закрытого.
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  select count(*) into n from public.product_photos where org_id = org_a;
  log := log || format(check_n, '09', case when n = 1 then 'ok  ' else 'FAIL' end, 'guest sees open catalog photo', n, 1);
  select count(*) into n from public.product_photos where org_id = org_b;
  log := log || format(check_n, '10', case when n = 0 then 'ok  ' else 'FAIL' end, 'guest sees no closed catalog photo', n, 0);
  begin insert into public.product_photos (product_id, org_id, path) values (p, org_a, org_a || '/' || p || '/gues1234.jpg');
    log := log || '11 FAIL guest added photo'::text;
  exception when others then log := log || ('11 ok guest denied: ' || sqlerrm); end;

  -- Версия каталога меняется от фото.
  v0 := public.catalog_version(org_a);
  perform set_config('role', 'postgres', true);
  delete from public.product_photos where path = f;
  perform set_config('role', 'anon', true);
  v1 := public.catalog_version(org_a);
  log := log || format(check_n, '12', case when v1 <> v0 then 'ok  ' else 'FAIL' end, 'photo removal changes version', 'changed', 'changed');

  -- Удаление файла: чужой владелец не может, свой — может.
  perform set_config('role', 'authenticated', true);
  perform set_config('storage.allow_delete_query', 'true', true);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  delete from storage.objects where bucket_id = 'product-photos' and name = f;
  get diagnostics n = row_count;
  log := log || format(check_n, '13', case when n = 0 then 'ok  ' else 'FAIL' end, 'foreign owner cannot delete file', n, 0);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  delete from storage.objects where bucket_id = 'product-photos' and name like org_a || '/%';
  get diagnostics n = row_count;
  log := log || format(check_n, '14', case when n = 2 then 'ok  ' else 'FAIL' end, 'owner deletes own files', n, 2);

  perform set_config('role', 'postgres', true);
  raise exception E'РЕЗУЛЬТАТ\n%', array_to_string(log, E'\n');
end;
$test$;
