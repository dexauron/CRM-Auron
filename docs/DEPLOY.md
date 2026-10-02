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
npx supabase@2.119.0 start -x gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
supabase/tests/run.sh
npx supabase@2.119.0 stop
```
Применение к тестовому проекту: `npx supabase@2.119.0 db push` (нужен вход в Supabase CLI) или через Claude/MCP.

## Сервер в РФ
Будет описан после ответа на вопрос 3 (`docs/QUESTIONS.md`).
