// Запуск внутри Telegram (Mini App). Вне Telegram скрипт SDK есть, но initData пустой.

interface TelegramWebApp {
  initData: string;
  colorScheme: 'light' | 'dark';
  themeParams: Partial<Record<string, string>>;
  ready: () => void;
  expand: () => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getTelegram(): TelegramWebApp | null {
  const app = window.Telegram?.WebApp;
  return app && app.initData ? app : null;
}

// Цвета темы Telegram → переменные CSS приложения (ТЗ, раздел 9).
const themeMap: Record<string, string> = {
  bg_color: '--bg',
  secondary_bg_color: '--surface',
  text_color: '--text',
  hint_color: '--muted',
  button_color: '--accent',
  button_text_color: '--accent-text',
};

export function applyTelegramTheme(app: TelegramWebApp): void {
  const root = document.documentElement;
  for (const [key, cssVar] of Object.entries(themeMap)) {
    const value = app.themeParams[key];
    if (value && /^#[0-9a-f]{3,8}$/i.test(value)) root.style.setProperty(cssVar, value);
  }
  root.dataset.scheme = app.colorScheme;
}
