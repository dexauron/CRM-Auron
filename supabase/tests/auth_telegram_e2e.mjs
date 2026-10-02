// Сквозная проверка входа через Telegram на локальном Supabase (функция auth-telegram запущена через `functions serve`).
// Запуск: PUB=<публичный ключ> SECRET=<секретный ключ> node supabase/tests/auth_telegram_e2e.mjs
// Ключи и токен — локальные тестовые, к реальному проекту и боту отношения не имеют.
import { webcrypto as crypto } from 'node:crypto';

const API = process.env.API_URL ?? 'http://127.0.0.1:54321';
const KEY = process.env.PUB;
const SECRET = process.env.SECRET;
const TOKEN = '123456789:TEST-token-for-unit-tests-only';
if (!KEY || !SECRET) throw new Error('Нужны PUB и SECRET (npx supabase status -o env)');

const enc = new TextEncoder();
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
async function initData(fields, token = TOKEN) {
  const p = new URLSearchParams(fields);
  const dcs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  p.set('hash', Buffer.from(await hmac(await hmac(enc.encode('WebAppData'), token), dcs)).toString('hex'));
  return p.toString();
}
async function login(data, origin = 'https://dexauron.github.io') {
  const r = await fetch(`${API}/functions/v1/auth-telegram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Origin: origin },
    body: JSON.stringify({ initData: data }),
  });
  return { status: r.status, body: await r.json(), cors: r.headers.get('access-control-allow-origin') };
}
const rest = (path, token) =>
  fetch(`${API}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${token}` } }).then((r) => r.json());
// В вывод (а он виден в публичных логах CI) токены не попадают — только статус и код ошибки.
const brief = (r) => `status=${r.status} ${r.body.error ?? ''}`;

// Пароль «злоумышленника» случайный при каждом запуске: в репозитории нет строк, похожих на секреты.
const attackerPassword = `${crypto.randomUUID()}-Aa1`;
const now = Math.floor(Date.now() / 1000);
const user = JSON.stringify({ id: 777000123, first_name: 'Тест', last_name: 'Покупатель' });
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'ok  ' : 'FAIL'} ${name} ${extra}`);

const first = await login(await initData({ auth_date: String(now), user }));
check('первый вход создаёт пользователя и выдаёт сессию', first.status === 200 && !!first.body.access_token, brief(first));
// Локальный Kong сам ставит '*' поверх ответа функции; в облаке приходит заголовок функции.
check('CORS разрешён для своего сайта', ['https://dexauron.github.io', '*'].includes(first.cors), `allow-origin=${first.cors}`);
const me = await rest('profiles?select=id,telegram_id,full_name', first.body.access_token);
check('профиль виден по своей сессии, telegram_id и имя записаны',
  me.length === 1 && me[0].telegram_id === 777000123 && me[0].full_name === 'Тест Покупатель', JSON.stringify(me));
const orgs = await rest('organizations?select=id', first.body.access_token);
check('новый пользователь не видит ни одного магазина', Array.isArray(orgs) && orgs.length === 0, JSON.stringify(orgs));

const second = await login(await initData({ auth_date: String(now), user }));
const me2 = await rest('profiles?select=id', second.body.access_token);
check('повторный вход — тот же пользователь', second.status === 200 && me2[0]?.id === me[0]?.id, brief(second));

const forged = await login(await initData({ auth_date: String(now), user }, '987654321:ATTACKER'));
check('подпись чужим токеном → 401', forged.status === 401 && forged.body.error === 'bad_signature', brief(forged));
const old = await login(await initData({ auth_date: String(now - 7200), user }));
check('данные старше часа → 401', old.status === 401 && old.body.error === 'expired', brief(old));
const evil = await login(await initData({ auth_date: String(now), user }), 'https://evil.example');
check('чужой сайт → 403', evil.status === 403, brief(evil));
const junk = await login('hello');
check('мусор → 401', junk.status === 401, brief(junk));

// Открытая регистрация по почте выключена (config.toml), иначе адрес tg<id>@telegram.invalid можно занять заранее.
const signup = await fetch(`${API}/auth/v1/signup`, {
  method: 'POST',
  headers: { apikey: KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'tg777000999@telegram.invalid', password: attackerPassword }),
});
check('открытая регистрация по почте выключена', signup.status !== 200, `signup=${signup.status}`);

// Если адрес всё же занят чужой учёткой (например, регистрацию включили) — вход не отдаёт её, а отвечает 409.
const victim = 777000998;
const taken = await fetch(`${API}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `tg${victim}@telegram.invalid`, password: attackerPassword, email_confirm: true }),
});
const victimLogin = await login(await initData({ auth_date: String(now), user: JSON.stringify({ id: victim, first_name: 'Жертва' }) }));
check('занятый адрес → 409, а не вход в чужую учётку',
  [200, 422].includes(taken.status) && victimLogin.status === 409 && !victimLogin.body.access_token,
  `admin=${taken.status} ${brief(victimLogin)}`);

// Учётка создана сервером (telegram_id в app_metadata), но профиль не дописан — следующий вход это чинит.
const halfDone = 777000997;
const orphan = await fetch(`${API}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `tg${halfDone}@telegram.invalid`, email_confirm: true, app_metadata: { telegram_id: halfDone } }),
}).then((r) => r.json());
const repaired = await login(await initData({ auth_date: String(now), user: JSON.stringify({ id: halfDone, first_name: 'Недописанный' }) }));
const repairedMe = await rest('profiles?select=id,telegram_id', repaired.body.access_token);
check('недописанный профиль чинится при входе, учётка та же',
  repaired.status === 200 && repairedMe[0]?.id === orphan.id && repairedMe[0]?.telegram_id === halfDone, brief(repaired));

console.log(results.join('\n'));
if (results.some((line) => line.startsWith('FAIL'))) process.exit(1);
