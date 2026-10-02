# Запуск и выкладка

## Интерфейс на GitHub Pages
1. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. Settings → Secrets and variables → Actions → вкладка **Variables** → New repository variable:
   - `VITE_SUPABASE_URL` — адрес проекта Supabase (Project Settings → API);
   - `VITE_SUPABASE_PUBLISHABLE_KEY` — публичный ключ `sb_publishable_…` (это не секрет: он виден в браузере,
     защита — правила доступа в базе).
3. Любой push в `main` пересобирает сайт: `https://dexauron.github.io/CRM-Auron/`.

## Локальная разработка
```bash
cd web
cp .env.example .env.local   # вписать адрес и публичный ключ тестового проекта
npm ci
npm run dev
```

## База
Изменения схемы — только новые файлы в `supabase/migrations/`.
```bash
npx supabase@2.119.0 start -x gotrue,realtime,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
supabase/tests/run.sh
npx supabase@2.119.0 stop
```
Применение к тестовому проекту: `npx supabase@2.119.0 db push` (нужен вход в Supabase CLI) или через Claude/MCP.

## Вход через Telegram
1. Токен бота — только в Supabase → Edge Functions → Secrets, имя `TELEGRAM_BOT_TOKEN`. Никому не пересылать,
   в репозиторий и на скриншоты не попадает. Если токен засветился — @BotFather → `/revoke` и новый токен сюда же.
2. Функция `auth-telegram` выкладывается командой
   `npx supabase@2.119.0 functions deploy auth-telegram --no-verify-jwt` (или через Claude).
   Проверка JWT шлюзом выключена намеренно: на входе у человека ещё нет сессии, подпись проверяет сама функция.
3. Supabase → Authentication → Sign In / Providers → выключить **Allow new users to sign up**.
   Провайдер **Email** оставить включённым: через него сервер выдаёт сессию (писем он не отправляет).
4. @BotFather → `/mybots` → бот → Bot Settings → Configure Mini App → включить и указать адрес
   `https://dexauron.github.io/CRM-Auron/`. Тогда кнопка бота открывает приложение, а ссылки-приглашения
   `https://t.me/<бот>?startapp=inv_<токен>` работают.
5. Вход с ПК: @BotFather → бот → Bot Settings → **Domain** (в новом меню BotFather — **Login Widget**) →
   `dexauron.github.io`. Без этого окно Telegram ответит «Bot domain invalid».
6. Необязательно: секрет `ALLOWED_ORIGINS` — сайты, с которых разрешён вход, через запятую
   (по умолчанию `https://dexauron.github.io`).

Если в приложении «Telegram не подтвердил вход»: Supabase → Edge Functions → `auth-telegram` → Logs.
- «Telegram не принял токен» — токен отозван: в секрет `TELEGRAM_BOT_TOKEN` положить действующий (@BotFather → API Token).
- «не похож на токен бота» — в секрете лишние символы или не то значение.
- «токен действует для @…» — приложение открыто из другого бота.

Проверка на своём компьютере (нужен Docker):
```bash
npx supabase@2.119.0 start -x realtime,imgproxy,mailpit,postgres-meta,studio,logflare,vector,supavisor
printf '%s\n' 'TELEGRAM_BOT_TOKEN=123456789:TEST-token-for-unit-tests-only' 'ALLOWED_ORIGINS=https://dexauron.github.io' > /tmp/functions.env
npx supabase@2.119.0 functions serve auth-telegram --env-file /tmp/functions.env &
eval "$(npx supabase@2.119.0 status -o env | grep -E '^(PUBLISHABLE_KEY|SECRET_KEY)=')"
PUB="$PUBLISHABLE_KEY" SECRET="$SECRET_KEY" node supabase/tests/auth_telegram_e2e.mjs
```
Тестовый токен ненастоящий; функция с ним принимает только данные, подписанные этим же тестовым токеном.

## Сервер в РФ
Будет описан после ответа на вопрос 3 (`docs/QUESTIONS.md`).
