// Проверка данных запуска Telegram Mini App (initData).
// Алгоритм — https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app:
//   secret = HMAC_SHA256(key = "WebAppData", message = токен бота)
//   hash   = hex(HMAC_SHA256(key = secret, message = data_check_string))
//   data_check_string — все поля, кроме hash, по алфавиту, «ключ=значение» через \n.
// Вход с ПК — окно Telegram Login (https://core.telegram.org/widgets/login#checking-authorization):
//   secret = SHA256(токен бота); hash = hex(HMAC_SHA256(key = secret, message = data_check_string)).
// Только Web Crypto — модуль работает и в Deno (Edge Functions), и в тестах.

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface VerifiedInitData {
  user: TelegramUser;
  authDate: number;
  startParam: string | null;
}

export type InitDataError = 'malformed' | 'bad_signature' | 'expired' | 'from_future' | 'no_user';

export class InitDataInvalid extends Error {
  constructor(readonly code: InitDataError) {
    super(code);
  }
}

const MAX_LENGTH = 4096;
const encoder = new TextEncoder();

async function hmac(key: Uint8Array<ArrayBuffer>, message: string): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Сравнение за постоянное время: не выдаёт по длительности, сколько символов совпало.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function dataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

export async function signInitData(params: URLSearchParams, botToken: string): Promise<string> {
  const secret = await hmac(encoder.encode('WebAppData'), botToken);
  return toHex(await hmac(secret, dataCheckString(params)));
}

/**
 * Проверяет подпись и свежесть initData. maxAgeSeconds — сколько живут данные запуска (ТЗ: не дольше часа).
 * Бросает InitDataInvalid с кодом причины.
 */
export async function verifyInitData(
  initData: string,
  botToken: string,
  options: { maxAgeSeconds?: number; now?: number } = {},
): Promise<VerifiedInitData> {
  if (typeof initData !== 'string' || initData.length === 0 || initData.length > MAX_LENGTH) {
    throw new InitDataInvalid('malformed');
  }
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) throw new InitDataInvalid('malformed');

  const expected = await signInitData(params, botToken);
  if (!safeEqual(expected, hash)) throw new InitDataInvalid('bad_signature');

  const authDate = Number(params.get('auth_date'));
  if (!Number.isSafeInteger(authDate) || authDate <= 0) throw new InitDataInvalid('malformed');
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (authDate > now + 60) throw new InitDataInvalid('from_future');
  if (now - authDate > (options.maxAgeSeconds ?? 3600)) throw new InitDataInvalid('expired');

  let user: unknown;
  try {
    user = JSON.parse(params.get('user') ?? 'null');
  } catch {
    throw new InitDataInvalid('malformed');
  }
  if (!user || typeof user !== 'object' || !Number.isSafeInteger((user as TelegramUser).id)) {
    throw new InitDataInvalid('no_user');
  }
  const u = user as TelegramUser;
  return {
    user: {
      id: u.id,
      ...(typeof u.first_name === 'string' ? { first_name: u.first_name.slice(0, 100) } : {}),
      ...(typeof u.last_name === 'string' ? { last_name: u.last_name.slice(0, 100) } : {}),
      ...(typeof u.username === 'string' ? { username: u.username.slice(0, 64) } : {}),
    },
    authDate,
    startParam: params.get('start_param'),
  };
}

// ── Окно Telegram Login (вход с ПК) ──────────────────────────────────────

const WIDGET_MAX_FIELDS = 12;
const WIDGET_MAX_VALUE = 512;

function widgetCheckString(fields: Record<string, string>): string {
  return Object.keys(fields)
    .filter((key) => key !== 'hash')
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
}

export async function signLoginWidget(fields: Record<string, string>, botToken: string): Promise<string> {
  const secret = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(botToken)));
  return toHex(await hmac(secret, widgetCheckString(fields)));
}

/**
 * Проверяет данные из окна Telegram Login: подпись токеном бота и свежесть.
 * Поля — простые строки и числа, как их присылает Telegram; всё остальное — malformed.
 */
export async function verifyLoginWidget(
  input: unknown,
  botToken: string,
  options: { maxAgeSeconds?: number; now?: number } = {},
): Promise<VerifiedInitData> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InitDataInvalid('malformed');
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0 || entries.length > WIDGET_MAX_FIELDS) throw new InitDataInvalid('malformed');
  // Объект без прототипа: ключ вроде «__proto__» не заденет служебные свойства.
  const fields = Object.create(null) as Record<string, string>;
  for (const [key, value] of entries) {
    if (!/^[a-z_]{1,32}$/.test(key)) throw new InitDataInvalid('malformed');
    if (typeof value !== 'string' && typeof value !== 'number') throw new InitDataInvalid('malformed');
    const text = String(value);
    if (text.length > WIDGET_MAX_VALUE) throw new InitDataInvalid('malformed');
    fields[key] = text;
  }
  const hash = fields.hash;
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) throw new InitDataInvalid('malformed');
  if (!safeEqual(await signLoginWidget(fields, botToken), hash)) throw new InitDataInvalid('bad_signature');

  const authDate = Number(fields.auth_date);
  if (!Number.isSafeInteger(authDate) || authDate <= 0) throw new InitDataInvalid('malformed');
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (authDate > now + 60) throw new InitDataInvalid('from_future');
  if (now - authDate > (options.maxAgeSeconds ?? 3600)) throw new InitDataInvalid('expired');

  const id = Number(fields.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new InitDataInvalid('no_user');
  return {
    user: {
      id,
      ...(fields.first_name ? { first_name: fields.first_name.slice(0, 100) } : {}),
      ...(fields.last_name ? { last_name: fields.last_name.slice(0, 100) } : {}),
      ...(fields.username ? { username: fields.username.slice(0, 64) } : {}),
    },
    authDate,
    startParam: null,
  };
}
