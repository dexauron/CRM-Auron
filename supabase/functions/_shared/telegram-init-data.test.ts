// Тесты проверки initData. Запуск: deno test supabase/functions/
import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.15';
import { dataCheckString, InitDataInvalid, signInitData, verifyInitData } from './telegram-init-data.ts';

// Вымышленный токен: настоящих токенов в репозитории быть не должно.
const TOKEN = '123456789:TEST-token-for-unit-tests-only';
const NOW = 1_790_000_000;

async function makeInitData(fields: Record<string, string>, token = TOKEN): Promise<string> {
  const params = new URLSearchParams(fields);
  params.set('hash', await signInitData(params, token));
  return params.toString();
}

const user = JSON.stringify({ id: 42, first_name: 'Тест', last_name: 'Пользователь', username: 'test_user' });

Deno.test('строка проверки: все поля кроме hash, по алфавиту', () => {
  const params = new URLSearchParams({ user: 'u', auth_date: '1', hash: 'x', signature: 's' });
  assertEquals(dataCheckString(params), 'auth_date=1\nsignature=s\nuser=u');
});

Deno.test('правильные данные принимаются', async () => {
  const initData = await makeInitData({ auth_date: String(NOW - 10), user, start_param: 'inv_abc', signature: 'sig' });
  const result = await verifyInitData(initData, TOKEN, { now: NOW });
  assertEquals(result.user.id, 42);
  assertEquals(result.user.first_name, 'Тест');
  assertEquals(result.startParam, 'inv_abc');
});

Deno.test('подпись чужим токеном отклоняется', async () => {
  const initData = await makeInitData({ auth_date: String(NOW), user }, '987654321:OTHER');
  const e = await assertRejects(() => verifyInitData(initData, TOKEN, { now: NOW }), InitDataInvalid);
  assertEquals(e.code, 'bad_signature');
});

Deno.test('подменённое поле отклоняется', async () => {
  const initData = await makeInitData({ auth_date: String(NOW), user });
  const tampered = initData.replace('%22id%22%3A42', '%22id%22%3A43');
  const e = await assertRejects(() => verifyInitData(tampered, TOKEN, { now: NOW }), InitDataInvalid);
  assertEquals(e.code, 'bad_signature');
});

Deno.test('данные старше часа отклоняются', async () => {
  const initData = await makeInitData({ auth_date: String(NOW - 3601), user });
  const e = await assertRejects(() => verifyInitData(initData, TOKEN, { now: NOW }), InitDataInvalid);
  assertEquals(e.code, 'expired');
});

Deno.test('данные «из будущего» отклоняются', async () => {
  const initData = await makeInitData({ auth_date: String(NOW + 3600), user });
  const e = await assertRejects(() => verifyInitData(initData, TOKEN, { now: NOW }), InitDataInvalid);
  assertEquals(e.code, 'from_future');
});

Deno.test('без пользователя или без подписи — отказ', async () => {
  const noUser = await makeInitData({ auth_date: String(NOW) });
  assertEquals((await assertRejects(() => verifyInitData(noUser, TOKEN, { now: NOW }), InitDataInvalid)).code, 'no_user');
  const noHash = `auth_date=${NOW}&user=${encodeURIComponent(user)}`;
  assertEquals((await assertRejects(() => verifyInitData(noHash, TOKEN, { now: NOW }), InitDataInvalid)).code, 'malformed');
  assertEquals((await assertRejects(() => verifyInitData('x'.repeat(5000), TOKEN, { now: NOW }), InitDataInvalid)).code, 'malformed');
});

Deno.test('совпадает с эталонной реализацией (Python hmac, формула из документации Telegram)', async () => {
  // Хэш посчитан независимо: hmac.new(hmac.new(b"WebAppData", token, sha256).digest(), dcs, sha256).hexdigest()
  const initData =
    'auth_date=1790000000&query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=%7B%22id%22%3A42%2C%22first_name%22%3A%22Test%22%7D' +
    '&signature=sig&hash=5325f102e9e5ab9f9445876ca16282fe11e2c9c650c9ccb50c0330625516c750';
  const result = await verifyInitData(initData, TOKEN, { now: 1_790_000_100 });
  assertEquals(result.user.id, 42);
});
