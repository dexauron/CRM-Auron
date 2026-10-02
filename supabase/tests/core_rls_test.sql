-- Тест прав доступа ядра (этап 0). Запуск: выполнить целиком в SQL-редакторе или через psql.
-- Создаёт вымышленных пользователей, проверяет 28 случаев и в конце бросает исключение
-- с отчётом — поэтому все изменения откатываются. Строка с «FAIL» = ошибка в правах.
do $test$
declare
  o uuid := gen_random_uuid(); s uuid := gen_random_uuid(); c uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  org_a uuid; org_b uuid; tok text; n int; m_s uuid; m_o uuid; log text[] := '{}';
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u::text || '@test.local', now(), now()
  from unnest(array[o, s, c, x]) u;
  insert into public.organizations (name) values ('Тест А') returning id into org_a;
  insert into public.organizations (name) values ('Тест Б') returning id into org_b;
  insert into public.memberships (org_id, user_id, role) values (org_a, o, 'owner') returning id into m_o;
  insert into public.memberships (org_id, user_id, role) values (org_a, c, 'customer'), (org_b, x, 'owner');

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  tok := public.create_invite(org_a, 'staff', 24);
  log := log || ('01 invite token len=' || length(tok));
  begin perform public.create_invite(org_a, 'owner', 24); log := log || '02 FAIL invite owner allowed'::text;
  exception when others then log := log || ('02 ok invite owner denied: ' || sqlerrm); end;
  begin perform token_hash from public.invites limit 1; log := log || '03 FAIL token_hash readable'::text;
  exception when others then log := log || ('03 ok token_hash hidden: ' || sqlerrm); end;

  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  perform public.accept_invite(tok);
  select count(*) into n from public.memberships; log := log || ('04 staff sees memberships=' || n || ' (1)');
  begin perform public.accept_invite(tok); log := log || '05 FAIL invite reused'::text;
  exception when others then log := log || ('05 ok reuse denied: ' || sqlerrm); end;
  select count(*) into n from public.organizations; log := log || ('06 staff sees orgs=' || n || ' (1)');
  select count(*) into n from public.profiles; log := log || ('07 staff sees profiles=' || n || ' (1)');
  begin insert into public.settings (org_id, key, value) values (org_a, 'x', '1'); log := log || '08 FAIL staff wrote settings'::text;
  exception when others then log := log || ('08 ok staff settings write denied: ' || sqlerrm); end;
  begin update public.profiles set phone = '+79000000000' where id = s; log := log || '09 FAIL staff set own phone'::text;
  exception when others then log := log || ('09 ok phone not writable: ' || sqlerrm); end;
  update public.profiles set full_name = 'Сотрудник Тест' where id = s; get diagnostics n = row_count;
  log := log || ('10 staff updated own name rows=' || n || ' (1)');
  select count(*) into n from public.audit_log; log := log || ('11 staff sees audit=' || n || ' (0)');

  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  select count(*) into n from public.settings; log := log || ('12 customer sees settings=' || n || ' (0)');
  select count(*) into n from public.profiles; log := log || ('13 customer sees profiles=' || n || ' (1)');
  insert into public.consents (org_id, user_id, kind, text_version) values (org_a, c, 'marketing', 'v1');
  log := log || '14 customer gave own consent'::text;
  begin insert into public.consents (org_id, user_id, kind, text_version) values (org_a, o, 'marketing', 'v1'); log := log || '15 FAIL consent for other user'::text;
  exception when others then log := log || ('15 ok consent for other denied: ' || sqlerrm); end;
  update public.consents set revoked_at = now() where user_id = c; get diagnostics n = row_count;
  log := log || ('16 customer revoked consent rows=' || n || ' (1)');
  update public.consents set revoked_at = null where user_id = c; get diagnostics n = row_count;
  log := log || ('17 un-revoke rows=' || n || ' (0)');

  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select count(*) into n from public.organizations; log := log || ('18 outsider sees orgs=' || n || ' (1)');
  select count(*) into n from public.memberships where org_id = org_a; log := log || ('19 outsider sees A memberships=' || n || ' (0)');
  begin perform public.create_invite(org_a, 'staff', 24); log := log || '20 FAIL outsider created invite'::text;
  exception when others then log := log || ('20 ok outsider invite denied: ' || sqlerrm); end;

  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  select count(*) into n from public.profiles; log := log || ('21 owner sees profiles=' || n || ' (3)');
  select count(*) into n from public.memberships; log := log || ('22 owner sees memberships=' || n || ' (3)');
  select count(*) into n from public.audit_log where org_id = org_a; log := log || ('23 owner sees audit rows=' || n || ' (>0)');
  select id into m_s from public.memberships where user_id = s;
  perform public.set_member_status(m_s, 'disabled');
  begin perform public.set_member_status(m_o, 'disabled'); log := log || '24 FAIL last owner disabled'::text;
  exception when others then log := log || ('24 ok last owner protected: ' || sqlerrm); end;

  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  select count(*) into n from public.organizations; log := log || ('25 disabled staff sees orgs=' || n || ' (0)');

  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  begin perform 1 from public.organizations limit 1; log := log || '26 FAIL anon read orgs'::text;
  exception when others then log := log || ('26 ok anon denied: ' || sqlerrm); end;
  begin perform public.accept_invite('x'); log := log || '27 FAIL anon called rpc'::text;
  exception when others then log := log || ('27 ok anon rpc denied: ' || sqlerrm); end;

  perform set_config('role', 'postgres', true);
  begin update public.audit_log set action = 'x'; log := log || '28 FAIL audit updated'::text;
  exception when others then log := log || ('28 ok audit append-only: ' || sqlerrm); end;

  raise exception E'РЕЗУЛЬТАТ (всё откатывается):\n%', array_to_string(log, E'\n');
end;
$test$;
