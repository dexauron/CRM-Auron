#!/usr/bin/env bash
# Проверка базы на обычной PostgreSQL, БЕЗ Docker и без Supabase CLI.
#
# ЗАЧЕМ. Основной способ — `supabase start` и `supabase/tests/run.sh` (так гоняет CI). Но в части
# окружений (например, в облачной сессии Claude) Docker недоступен вовсе, и тогда правку миграции
# пришлось бы отправлять «на удачу» и ждать CI. Этот скрипт поднимает локальную PostgreSQL, ставит
# МИНИМАЛЬНЫЕ подпорки вместо Supabase и прогоняет те же миграции и тесты прав.
#
# ВАЖНО, НЕ ПУТАТЬ. Схемы `auth` и `storage` здесь — заглушки на несколько колонок, а не настоящий
# Supabase. Зелёный результат тут означает «синтаксис в порядке и права ведут себя как задумано»,
# но НЕ заменяет CI. Истина — CI. Если здесь зелено, а в CI красно — прав CI.
#
# Запуск (не из-под root: initdb это запрещает):
#   setpriv --reuid=postgres --regid=postgres --init-groups supabase/tests/local-no-docker.sh
# Каталог для базы можно задать: PGHARNESS=/своя/папка (по умолчанию ~/crm-harness).
set -euo pipefail

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PGBIN/initdb" ] || { echo "Не нашёл initdb. Укажите PGBIN=/usr/lib/postgresql/NN/bin"; exit 1; }
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
H="${PGHARNESS:-$HOME/crm-harness}"
DATA="$H/data"; SOCK="$H/sock"

rm -rf "$DATA" "$SOCK"; mkdir -p "$DATA" "$SOCK"
# Локаль ru через ICU обязательна: при локали C функция lower() НЕ приводит кириллицу к нижнему
# регистру, и проверки вида «ООО Ромашка» = « ооо ромашка » падают на ровном месте.
"$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust --encoding=UTF8 \
  --locale-provider=icu --icu-locale=ru-RU --locale=C.utf8 >/dev/null
"$PGBIN/pg_ctl" -D "$DATA" -o "-k $SOCK -h '' -c log_min_messages=warning" -l "$H/log" start >/dev/null
trap '"$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true' EXIT
export PGHOST="$SOCK" PGUSER=postgres PGDATABASE=postgres

psql -q -v ON_ERROR_STOP=1 <<'BOOT'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_admin superuser login;
grant anon, authenticated, service_role to postgres;
create schema auth;
create schema storage;
create schema extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema auth, storage, extensions to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid, aud text, role text, email text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table auth.sessions (
  id uuid primary key default gen_random_uuid(), user_id uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
-- Как в Supabase: роль и уровень входа приходят из разобранного JWT.
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb, '{}'::jsonb);
$$;
create table storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
  name text, owner uuid, created_at timestamptz default now(), metadata jsonb
);
alter table storage.objects enable row level security;
grant select on auth.users to authenticated;
grant all on storage.objects, storage.buckets to authenticated, service_role;
BOOT

for m in "$REPO"/supabase/migrations/*.sql; do
  if ! psql -q -v ON_ERROR_STOP=1 -f "$m" >"$H/out.txt" 2>&1; then
    echo "ПРОВАЛ миграции $(basename "$m"):"; tail -25 "$H/out.txt"; exit 1
  fi
done
echo "ok: все миграции применились"

no_rls=$(psql -At -c "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity")
[ -z "$no_rls" ] || { echo "ОШИБКА: таблицы без RLS: $no_rls"; exit 1; }
echo "ok: RLS включён у всех таблиц public"

failed=0
for t in "$REPO"/supabase/tests/*_test.sql; do
  report=$(psql -v ON_ERROR_STOP=1 -f "$t" 2>&1 || true)
  if ! grep -q "РЕЗУЛЬТАТ" <<<"$report"; then
    echo "ОШИБКА: $(basename "$t") не дошёл до конца:"; echo "$report" | tail -20; failed=1; continue
  fi
  if grep -q "FAIL" <<<"$report"; then
    echo "ОШИБКА в $(basename "$t"):"; grep "FAIL" <<<"$report"; failed=1; continue
  fi
  echo "ok: $(basename "$t") ($(grep -cE '^[0-9]{2} ' <<<"$report") проверок)"
done
exit $failed
