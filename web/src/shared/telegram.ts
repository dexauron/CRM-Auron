// Запуск внутри Telegram (Mini App).
// SDK Telegram подключается только когда приложение открыто из Telegram и не блокирует запуск:
// если telegram.org недоступен или отвечает медленно, приложение всё равно открывается.

const SDK_URL = 'https://telegram.org/js/telegram-web-app.js';
const SDK_TIMEOUT_MS = 4000;

export interface TelegramWebApp {
  initData: string;
  /** Неподписанная копия initData: только для интерфейса, сервер доверяет лишь initData. */
  initDataUnsafe: { user?: { id: number }; start_param?: string };
  colorScheme: 'light' | 'dark';
  themeParams: Partial<Record<string, string>>;
  ready: () => void;
  expand: () => void;
  /** Открыть ссылку t.me внутри Telegram (например, «поделиться»). */
  openTelegramLink?: (url: string) => void;
  setHeaderColor?: (color: string) => void;
  /** Кнопка «Назад» в шапке Telegram. */
  BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void };
  setBackgroundColor?: (color: string) => void;
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

// Цвета темы Telegram → переменные CSS приложения (ТЗ, раздел 9). Для каждой переменной — список ключей
// по приоритету: новые клиенты присылают цвета секций, старые — только основные.
const themeMap: Record<string, readonly string[]> = {
  '--bg': ['secondary_bg_color'],
  '--surface': ['section_bg_color', 'bg_color'],
  '--text': ['text_color'],
  '--muted': ['subtitle_text_color', 'hint_color'],
  '--section-header': ['section_header_text_color', 'hint_color'],
  '--separator': ['section_separator_color'],
  '--accent': ['button_color'],
  '--accent-text': ['button_text_color'],
  '--link': ['accent_text_color', 'link_color'],
  '--bad': ['destructive_text_color'],
};

const isColor = (value: string | undefined): value is string => Boolean(value && /^#[0-9a-f]{3,8}$/i.test(value));

export function themeVariables(themeParams: Partial<Record<string, string>>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [cssVar, keys] of Object.entries(themeMap)) {
    const value = keys.map((key) => themeParams[key]).find(isColor);
    if (value) result[cssVar] = value;
  }
  return result;
}

export function applyTelegramTheme(app: TelegramWebApp): void {
  const root = document.documentElement;
  for (const [cssVar, value] of Object.entries(themeVariables(app.themeParams))) root.style.setProperty(cssVar, value);
  root.dataset.scheme = app.colorScheme;
  // Шапка и фон Telegram — цвета страницы: верх приложения не отделён полосой.
  try {
    app.setHeaderColor?.('secondary_bg_color');
    app.setBackgroundColor?.('secondary_bg_color');
  } catch {
    // Старые клиенты Telegram этого не умеют — не страшно.
  }
}
