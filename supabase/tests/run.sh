#!/usr/bin/env bash
# Проверки базы для CI и локального запуска:
#   1) в схеме public нет таблиц без RLS;
#   2) тест прав ядра: все 28 проверок без «FAIL».
# Использование: DB_URL=postgresql://... supabase/tests/run.sh
set -euo pipefail
DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
cd "$(dirname "$0")"

no_rls=$(psql "$DB_URL" -At -c "
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity")
if [ -n "$no_rls" ]; then
  echo "ОШИБКА: таблицы без RLS: $no_rls"
  exit 1
fi
echo "ok: у всех таблиц public включён RLS"

failed=0
for test in *_test.sql; do
  # Тест заканчивается исключением с отчётом — так все его изменения откатываются.
  report=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$test" 2>&1 || true)
  if ! grep -q "РЕЗУЛЬТАТ" <<<"$report"; then
    echo "ОШИБКА: $test не дошёл до конца:"; echo "$report"; failed=1; continue
  fi
  if grep -q "FAIL" <<<"$report"; then
    echo "ОШИБКА в $test:"; grep "FAIL" <<<"$report"; failed=1; continue
  fi
  echo "ok: $test ($(grep -cE '^[0-9]{2} ' <<<"$report") проверок)"
done
exit $failed
