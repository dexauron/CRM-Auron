// Публичные настройки сборки (не секреты).
/** Имя бота без @: из него собираются ссылки-приглашения t.me/<бот>?startapp=… */
export const TELEGRAM_BOT = import.meta.env.VITE_TELEGRAM_BOT || 'auron_core_bot';
/** Короткое имя магазина: по нему гость открывает каталог без входа. */
export const STORE_SLUG = import.meta.env.VITE_STORE_SLUG || 'way-market';
