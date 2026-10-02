// Публичные настройки сборки (не секреты).
/** Имя бота без @: из него собираются ссылки-приглашения t.me/<бот>?startapp=… */
export const TELEGRAM_BOT = import.meta.env.VITE_TELEGRAM_BOT || 'auron_core_bot';
