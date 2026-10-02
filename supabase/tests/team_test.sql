-- Тест команды магазина: отзыв приглашения и отключение участника с закрытием сессий.
-- Как и core_rls_test.sql: в конце исключение с отчётом, всё откатывается; «FAIL» = ошибка.
do $test$
declare
  o uuid := gen_random_uuid(); s uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  org_a uuid; org_b uuid; tok text; inv uuid; m_s uuid; n int; log text[] := '{}';
  check_n constant text := '%s %s %s=%s (ожидалось %s)';
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u::text || '@test.local', now(), now()
  from unnest(array[o, s, x]) u;
  insert into public.organizations (name) values ('Тест А') returning id into org_a;
  insert into public.organizations (name) values ('Тест Б') returning id into org_b;
  insert into public.memberships (org_id, user_id, role) values (org_a, o, 'owner'), (org_b, x, 'owner');

  -- Владелец создаёт и отзывает приглашение.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  tok := public.create_invite(org_a, 'staff', 24);
  select id into inv from public.invites where org_id = org_a order by created_at desc limit 1;

  -- Чужой владелец не может отозвать.
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  begin perform public.revoke_invite(inv); log := log || '01 FAIL outsider revoked invite'::text;
  exception when others then log := log || ('01 ok outsider revoke denied: ' || sqlerrm); end;

  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform public.revoke_invite(inv);
  select count(*) into n from public.invites where id = inv and expires_at <= now();
  log := log || format(check_n, '02', case when n = 1 then 'ok  ' else 'FAIL' end, 'revoked invite expired', n, 1);

  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  begin perform public.accept_invite(tok); log := log || '03 FAIL revoked invite accepted'::text;
  exception when others then log := log || ('03 ok revoked invite rejected: ' || sqlerrm); end;

  -- Новое приглашение работает; отключение закрывает сессии сотрудника.
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  tok := public.create_invite(org_a, 'staff', 24);
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform public.accept_invite(tok);

  perform set_config('role', 'postgres', true);
  insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), s, now(), now()), (gen_random_uuid(), o, now(), now());
  select id into m_s from public.memberships where org_id = org_a and user_id = s;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  begin perform public.set_member_status(m_s, 'active'); log := log || '04 FAIL staff changed own status'::text;
  exception when others then log := log || ('04 ok staff status change denied: ' || sqlerrm); end;

  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform public.set_member_status(m_s, 'disabled');

  perform set_config('role', 'postgres', true);
  select count(*) into n from auth.sessions where user_id = s;
  log := log || format(check_n, '05', case when n = 0 then 'ok  ' else 'FAIL' end, 'disabled staff sessions', n, 0);
  select count(*) into n from auth.sessions where user_id = o;
  log := log || format(check_n, '06', case when n = 1 then 'ok  ' else 'FAIL' end, 'owner sessions untouched', n, 1);

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.organizations;
  log := log || format(check_n, '07', case when n = 0 then 'ok  ' else 'FAIL' end, 'disabled staff sees orgs', n, 0);

  -- Включение возвращает доступ.
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform public.set_member_status(m_s, 'active');
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into n from public.organizations;
  log := log || format(check_n, '08', case when n = 1 then 'ok  ' else 'FAIL' end, 're-enabled staff sees orgs', n, 1);

  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  begin perform public.revoke_invite(inv); log := log || '09 FAIL anon revoked'::text;
  exception when others then log := log || ('09 ok anon revoke denied: ' || sqlerrm); end;

  raise exception E'РЕЗУЛЬТАТ (всё откатывается):\n%', array_to_string(log, E'\n');
end
$test$;
