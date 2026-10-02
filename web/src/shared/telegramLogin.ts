// Вход с ПК: окно авторизации Telegram (oauth.telegram.org) без стороннего скрипта.
// Готовая кнопка Telegram исполняет код через eval — это запрещено нашей политикой CSP, поэтому окно
// открываем сами и принимаем ответ так же, как официальный скрипт: сообщением от окна или запросом /auth/get.
// Данные входа здесь не проверяются — подпись проверяет серверная функция auth-telegram.

const ORIGIN = 'https://oauth.telegram.org';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** undefined — сообщение не о входе; null — человек отказался; объект — данные входа. */
export function parseAuthMessage(data: unknown): Record<string, unknown> | null | undefined {
  let parsed: unknown = data;
  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  if (!isRecord(parsed) || parsed.event !== 'auth_result') return undefined;
  return isRecord(parsed.result) ? parsed.result : null;
}

async function fetchAuthResult(botId: number): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${ORIGIN}/auth/get`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
    body: `bot_id=${botId}`,
  });
  const data: unknown = await response.json();
  return isRecord(data) && isRecord(data.user) ? data.user : null;
}

export class PopupBlocked extends Error {}

/**
 * Открывает окно Telegram. Вызывать прямо из обработчика нажатия: иначе браузер заблокирует окно.
 * Возвращает данные входа или null, если человек закрыл окно или отказался.
 */
export function openTelegramLogin(botId: number): Promise<Record<string, unknown> | null> {
  const width = 550;
  const height = 470;
  const left = Math.max(0, (window.screen.width - width) / 2);
  const top = Math.max(0, (window.screen.height - height) / 2);
  const url =
    `${ORIGIN}/auth?bot_id=${botId}&origin=${encodeURIComponent(window.location.origin)}` +
    `&request_access=write&return_to=${encodeURIComponent(window.location.href)}`;
  const popup = window.open(url, `telegram_oauth_bot${botId}`, `width=${width},height=${height},left=${left},top=${top}`);
  if (!popup) return Promise.reject(new PopupBlocked());

  return new Promise((resolve) => {
    let done = false;
    const finish = (result: Record<string, unknown> | null) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      window.clearInterval(timer);
      resolve(result);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== ORIGIN || event.source !== popup) return;
      const result = parseAuthMessage(event.data);
      if (result !== undefined) finish(result);
    };
    window.addEventListener('message', onMessage);
    const timer = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(timer);
      // Окно закрылось без сообщения — спрашиваем результат у Telegram, как официальный скрипт.
      fetchAuthResult(botId).then(finish, () => finish(null));
    }, 300);
  });
}
