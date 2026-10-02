// Вход через Telegram Mini App (ТЗ: раздел 2, раздел 7.1 «Подделка входа через Telegram»).
//
// Браузер присылает initData из Telegram. Функция проверяет подпись токеном бота и свежесть (не старше часа),
// находит или создаёт пользователя и возвращает сессию Supabase. Пароли не используются.
// Пользователь заводится с адресом tg<id>@telegram.invalid (домен .invalid не принимает почту),
// а связь с Telegram хранится в profiles.telegram_id и app_metadata (их не может изменить сам пользователь).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';
import { InitDataInvalid, verifyInitData, type TelegramUser } from '../_shared/telegram-init-data.ts';

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://dexauron.github.io')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

function key(name: 'SECRET' | 'PUBLISHABLE'): string {
  // Платформа: JSON-словарь SUPABASE_SECRET_KEYS / SUPABASE_PUBLISHABLE_KEYS; локально CLI даёт одиночные ключи.
  const dict = Deno.env.get(`SUPABASE_${name}_KEYS`);
  if (dict) {
    const value = (JSON.parse(dict) as Record<string, string>)['default'];
    if (value) return value;
  }
  const single = Deno.env.get(`SUPABASE_${name}_KEY`);
  if (single) return single;
  const legacy = Deno.env.get(name === 'SECRET' ? 'SUPABASE_SERVICE_ROLE_KEY' : 'SUPABASE_ANON_KEY');
  if (legacy) return legacy;
  throw new Error(`нет ключа ${name}`);
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, apikey, x-client-info, authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(origin) },
  });
}

function displayName(user: TelegramUser): string | null {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return name ? name.slice(0, 200) : null;
}

async function findUserId(admin: SupabaseClient, telegramId: number): Promise<string | null> {
  const { data, error } = await admin.from('profiles').select('id').eq('telegram_id', telegramId).maybeSingle();
  if (error) throw new Error(`profiles: ${error.message}`);
  return data?.id ?? null;
}

const emailFor = (telegramId: number) => `tg${telegramId}@telegram.invalid`;

async function linkProfile(admin: SupabaseClient, userId: string, tg: TelegramUser): Promise<void> {
  const { error } = await admin.from('profiles').update({ telegram_id: tg.id, full_name: displayName(tg) }).eq('id', userId);
  if (error) throw new Error(`profiles update: ${error.message}`);
}

async function findOrCreateUser(admin: SupabaseClient, tg: TelegramUser): Promise<string> {
  const existing = await findUserId(admin, tg.id);
  if (existing) return existing;

  const email = emailFor(tg.id);
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { provider: 'telegram', telegram_id: tg.id },
    user_metadata: { full_name: displayName(tg) },
  });
  let userId = created.data.user?.id;
  if (!userId) {
    if (created.error?.code !== 'email_exists') throw new Error(`createUser: ${created.error?.message ?? 'no user'}`);
    // Адрес уже есть: гонка двух первых входов, недописанный профиль или чужая учётка.
    // app_metadata пишет только сервер, поэтому совпадение telegram_id доказывает, что учётку создали мы.
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    const owner = link.data.user;
    if (link.error || !owner || owner.app_metadata?.telegram_id !== tg.id) throw new Error('account_conflict');
    userId = owner.id;
  }
  await linkProfile(admin, userId, tg);
  return userId;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: 'origin_not_allowed' }, 403, origin);

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!botToken) {
    console.error('auth-telegram: не задан секрет TELEGRAM_BOT_TOKEN');
    return json({ error: 'server_not_configured' }, 500, origin);
  }

  let initData: unknown;
  try {
    ({ initData } = (await req.json()) as { initData?: unknown });
  } catch {
    return json({ error: 'malformed' }, 400, origin);
  }

  let verified;
  try {
    verified = await verifyInitData(String(initData ?? ''), botToken);
  } catch (e) {
    if (e instanceof InitDataInvalid) return json({ error: e.code }, 401, origin);
    throw e;
  }

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url, key('SECRET'), { auth: { persistSession: false, autoRefreshToken: false } });
    const userId = await findOrCreateUser(admin, verified.user);

    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: emailFor(verified.user.id) });
    if (link.error || link.data.user?.id !== userId) throw new Error(`generateLink: ${link.error?.message ?? 'user mismatch'}`);

    const anon = createClient(url, key('PUBLISHABLE'), { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await anon.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'email' });
    if (error || !data.session) throw new Error(`verifyOtp: ${error?.message ?? 'no session'}`);

    return json(
      {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
      },
      200,
      origin,
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // В журнал — только причина, без initData, токенов и телефонов.
    console.error('auth-telegram:', message);
    return json({ error: message === 'account_conflict' ? 'account_conflict' : 'internal' }, message === 'account_conflict' ? 409 : 500, origin);
  }
});
