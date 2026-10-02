// Запуск внутри Telegram (Mini App).
// SDK Telegram подключается только когда приложение открыто из Telegram и не блокирует запуск:
// если telegram.org недоступен или отвечает медленно, приложение всё равно открывается.

const SDK_URL = 'https://telegram.org/js/telegram-web-app.js';
const SDK_TIMEOUT_MS = 4000;

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

/** Признаки запуска из Telegram: параметры в адресе или сохранённые SDK при перезагрузке страницы. */
export function looksLikeTelegramLaunch(hash: string, storedInitParams: string | null): boolean {
  return /tgWebApp(Data|Platform|Version)=/.test(hash) || storedInitParams !== null;
}

function storedInitParams(): string | null {
  try {
    return window.sessionStorage.getItem('__telegram__initParams');
  } catch {
    return null;
  }
}

export function getTelegram(): TelegramWebApp | null {
  const app = window.Telegram?.WebApp;
  return app && app.initData ? app : null;
}

/** Подключает SDK, если приложение открыто из Telegram. Не дольше SDK_TIMEOUT_MS, ошибки не роняют приложение. */
export function loadTelegram(): Promise<TelegramWebApp | null> {
  if (!looksLikeTelegramLaunch(window.location.hash, storedInitParams())) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), SDK_TIMEOUT_MS);
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => {
      window.clearTimeout(timer);
      resolve(getTelegram());
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    document.head.append(script);
  });
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
