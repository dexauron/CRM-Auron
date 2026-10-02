# Безопасность

## Как сообщить об уязвимости
Не создавайте публичный issue. Сообщите владельцу репозитория через GitHub: Security → Report a vulnerability (функция включается в Settings → Code security → Private vulnerability reporting).

## Чеклист (OWASP ASVS 2, выборочно; дополняется на каждом этапе)

| Требование | Статус | Где |
| --- | --- | --- |
| RLS на всех таблицах, по умолчанию запрещено | готово | `supabase/migrations/*_core.sql`, проверка в `supabase/tests/run.sh` |
| Автотесты прав по ролям | готово (ядро) | `supabase/tests/core_rls_test.sql` |
| Денежные и статусные изменения только через серверные функции | готово (ядро) | RPC `create_invite`, `accept_invite`, `set_member_status` |
| Журнал действий только на добавление | готово | триггер `audit_log_append_only` |
| Нет секретов в репозитории | готово | gitleaks в CI, push protection GitHub — включить в настройках |
| Запрет вставки HTML из данных (XSS) | готово | правило ESLint `no-restricted-syntax` |
| CSP | готово | `web/vite.config.ts`; `wasm-unsafe-eval` только для сканера, `eval` запрещён |
| Уязвимые зависимости | готово | `npm audit` в CI, Dependabot, действия закреплены по хэшу |
| Статический анализ | готово | CodeQL |
| Вход через Telegram с проверкой подписи и срока | готово | `supabase/functions/auth-telegram`, тесты `_shared/*.test.ts`, `supabase/tests/auth_telegram_e2e.mjs` |
| Вход с ПК через окно Telegram: подпись проверяет сервер, без стороннего скрипта | готово | `shared/telegramLogin.ts`, `verifyLoginWidget`, тесты |
| Нет паролей; открытая регистрация выключена | готово | `supabase/config.toml`, `docs/DECISIONS.md` |
| Защита от захвата учётки заранее занятым адресом | готово | проверка `app_metadata.telegram_id`, сквозной тест (409) |
| Токены и `initData` не пишутся в журнал | готово | `auth-telegram/index.ts` |
| Отключение доступа одним действием, все сессии закрываются | готово | `set_member_status`, тест `team_test.sql` |
| Гость и покупатель не получают закупку и остаток даже прямым запросом | готово | отдельная таблица `product_internals`, тест `catalog_test.sql` |
| Внешние сайты в CSP — только Telegram, данные старого каталога на GitHub и Open Food Facts (открытые данные) | готово | `web/vite.config.ts`, `api/openFoodFacts.ts` |
| Предупреждения Supabase Advisors о `SECURITY DEFINER`-функциях — намеренно: роль проверяется внутри каждой | принято | `docs/DECISIONS.md` |
| Фото: запись только в папку своего магазина, EXIF (геолокация) удаляется до загрузки | готово | `photos_test.sql`, `shared/image.ts`, сценарий в Chromium |
| На устройстве — только открытый каталог; закрыли каталог — копия стирается | готово | `catalogCache.ts`, сценарий в Chromium |
| Закупка и остатки из 1С — только владелец с кодом, только товары своего магазина | готово | `import_internals`, тест `import_1c_test.sql` |
| Импорт каталога только через RPC с проверкой роли и магазина | готово | `import_catalog`, тест `import_test.sql` |
| КАТ-6: отчёт с проверкой роли и aal2 внутри функции, только свой магазин, без сохранения закупок на устройстве | готово | `catalog_issues`, `catalog_tools_test.sql`, `web/e2e/catalog-tools.test.mjs` |
| Поставщики: правят владелец и управляющий, читают бухгалтер и сотрудник, ТП — только свой; привязку ТП через API не подделать | готово | RLS `suppliers`, `supplier_contacts`, тест `suppliers_test.sql` |
| 152-ФЗ: массовая загрузка настоящих контактов только на сервере с флагом `real_personal_data` (ставится SQL, не через API) | готово | `import_supplier_contacts`, `private.instance_settings`, тест `suppliers_test.sql` |
| «Закончилось на полке»: отмечают владелец, управляющий, сотрудник; сотрудник не видит цен поставщиков и имён коллег | готово | RLS `restock_marks`, `restock_list`, тест `restock_test.sql` |
| Цены поставщиков товара: видят владелец, управляющий, бухгалтер; из 1С — только владелец и только с флагом 152-ФЗ | готово | RLS `product_suppliers`, `import_supplier_prices`, тест `restock_test.sql` |
| Цены конкурентов: видят только свои роли, автор ставится сервером, чужую запись сотрудник не удалит, дата не из будущего | готово | RLS `competitor_prices`, тест `competitors_test.sql` |
| Продажи из 1С: загружает только владелец с кодом, дописывать можно только в свою незавершённую загрузку; видят владелец, управляющий, бухгалтер | готово | `import_sales`, тест `sales_test.sql` |
| Отзыв приглашения | готово | `revoke_invite`, тест `team_test.sql` |
| Второй фактор для владельца, управляющего, бухгалтера | готово | миграция `second_factor`: права только в сессии aal2; тест `second_factor_test.sql`; экран `SecondFactor.tsx` |
| Ограничение частоты запросов | не начато | сервер в РФ |
| Сервер: только 80/443/SSH, Studio закрыта | не начато | вопрос 3 |
| Резервные копии и проверка восстановления | не начато | вопрос 5 |
