# Ход работ

## 2026-10-02 — исправление: пустой экран при медленном telegram.org (Claude)
- Сайт выложен на GitHub Pages: https://dexauron.github.io/CRM-Auron/
- Найдено: при зависшем запросе к telegram.org приложение не запускалось. SDK Telegram теперь грузится только
  внутри Telegram, асинхронно и с ограничением 4 с (`web/src/shared/telegram.ts`), тесты — `telegram.test.ts`.
- Проверено в Chromium: браузер, Telegram с зависшим и с недоступным telegram.org — отрисовка за ~0,2 с;
  Telegram с рабочим SDK — тема Telegram применяется, нарушений CSP нет.

## 2026-10-02 — этап 0, часть 1 (Claude)

Сделано:
- База ядра (`supabase/migrations/`): organizations, profiles, memberships, invites, settings, consents,
  audit_log, outbox. RLS на всех таблицах, права выдаются явно, гость не видит ничего.
- Серверные функции: `create_invite`, `accept_invite`, `set_member_status`.
- Тест прав `supabase/tests/core_rls_test.sql` — 28 проверок; запускатель `supabase/tests/run.sh`
  также проверяет, что в `public` нет таблиц без RLS.
- Миграции применены к тестовому проекту Supabase `CRM-Auron-Test` (Франкфурт) и проверены на локальной базе.
- Каркас интерфейса `web/`: React + TypeScript + Vite, PWA (установка на Android и iPhone),
  запуск внутри Telegram с его цветами, проверка связи с сервером, плашка «доступно обновление»,
  индикатор «нет интернета». CSP в сборке. Утилиты денег и телефонов с тестами.
- CI: линтер, типы, тесты, сборка, `npm audit`, тесты базы, gitleaks; CodeQL; выкладка на GitHub Pages; Dependabot.

Не сделано в этапе 0:
- вход через Telegram и второй фактор для владельца (нужен бот — вопрос 4);
- сервер в РФ, домен, HTTPS, резервные копии (вопросы 2, 3, 5);
- `docs/SECURITY.md` — чеклист ASVS заполнен частично.

Следующий шаг: Edge Function `auth-telegram` (вход по `initData`), затем экран приглашений.

Нужно от владельца:
1. ~~Включить GitHub Pages~~ — сделано.
2. ~~Добавить переменные `VITE_SUPABASE_URL` и `VITE_SUPABASE_PUBLISHABLE_KEY`~~ — сделано.
3. Создать бота у @BotFather и положить токен в Supabase → Edge Functions → Secrets (`TELEGRAM_BOT_TOKEN`).

Известные ограничения:
- Проект Supabase во Франкфурте — только для вымышленных данных (152-ФЗ, ТЗ раздел 7.2).
