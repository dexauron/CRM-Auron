-- Тест второго фактора: привилегии владельца, управляющего и бухгалтера — только в сессии aal2.
-- Как и остальные: в конце исключение с отчётом, всё откатывается; «FAIL» = ошибка.
do $test$
declare
  o uuid := gen_random_uuid(); m uuid := gen_random_uuid(); s uuid := gen_random_uuid();
  org_a uuid; n int; ok boolean; log text[] := '{}';
  check_n constant text := '%s %s %s=%s (ожидалось %s)';
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u::text || '@test.local', now(), now()
  from unnest(array[o, m, s]) u;
  insert into public.organizations (name) values ('Тест А') returning id into org_a;
  insert into public.memberships (org_id, user_id, role) values (org_a, o, 'owner'), (org_a, m, 'manager'), (org_a, s, 'staff');

  perform set_config('role', 'authenticated', true);

  -- Владелец без кода (aal1): участник, но без привилегий.
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  select count(*) into n from public.organizations;
  log := log || format(check_n, '01', case when n = 1 then 'ok  ' else 'FAIL' end, 'owner aal1 sees own org', n, 1);
  select count(*) into n from public.memberships;
  log := log || format(check_n, '02', case when n = 1 then 'ok  ' else 'FAIL' end, 'owner aal1 sees only own membership', n, 1);
  begin perform public.create_invite(org_a, 'staff', 24); log := log || '03 FAIL owner aal1 created invite'::text;
  exception when others then log := log || ('03 ok owner aal1 invite denied: ' || sqlerrm); end;
  select count(*) into n from public.profiles;
  log := log || format(check_n, '04', case when n = 1 then 'ok  ' else 'FAIL' end, 'owner aal1 sees profiles', n, 1);
  select count(*) into n from public.audit_log;
  log := log || format(check_n, '05', case when n = 0 then 'ok  ' else 'FAIL' end, 'owner aal1 sees audit', n, 0);

  -- Без отметки уровня вовсе — то же самое.
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  begin perform public.create_invite(org_a, 'staff', 24); log := log || '06 FAIL owner without aal created invite'::text;
  exception when others then log := log || ('06 ok owner without aal denied: ' || sqlerrm); end;

  -- Владелец с кодом (aal2): всё доступно.
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  ok := length(public.create_invite(org_a, 'staff', 24)) = 64;
  log := log || format(check_n, '07', case when ok then 'ok  ' else 'FAIL' end, 'owner aal2 created invite', ok, true);
  select count(*) into n from public.memberships;
  log := log || format(check_n, '08', case when n = 3 then 'ok  ' else 'FAIL' end, 'owner aal2 sees memberships', n, 3);

  -- Управляющий без кода не видит чужие профили; с кодом — видит.
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  select count(*) into n from public.profiles;
  log := log || format(check_n, '09', case when n = 1 then 'ok  ' else 'FAIL' end, 'manager aal1 sees profiles', n, 1);
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.profiles;
  log := log || format(check_n, '10', case when n = 3 then 'ok  ' else 'FAIL' end, 'manager aal2 sees profiles', n, 3);

  -- Сотруднику код не нужен: магазин и свои данные видны и в aal1.
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  select count(*) into n from public.organizations;
  log := log || format(check_n, '11', case when n = 1 then 'ok  ' else 'FAIL' end, 'staff aal1 sees org', n, 1);

  -- Подделать уровень нельзя: он в подписанном токене, а не в запросе. Здесь — проверка, что подмена
  -- роли в чужом токене не даёт прав: сотрудник с aal2 остаётся сотрудником.
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  begin perform public.create_invite(org_a, 'staff', 24); log := log || '12 FAIL staff aal2 created invite'::text;
  exception when others then log := log || ('12 ok staff aal2 still no owner rights: ' || sqlerrm); end;

  raise exception E'РЕЗУЛЬТАТ (всё откатывается):\n%', array_to_string(log, E'\n');
end
$test$;
