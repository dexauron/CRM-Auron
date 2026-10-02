// Тесты окна Telegram Login (вход с ПК). Запуск: deno test supabase/functions/
import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.15';
import { InitDataInvalid, signLoginWidget, verifyLoginWidget } from './telegram-init-data.ts';

// Вымышленный токен: настоящих токенов в репозитории быть не должно.
const TOKEN = '123456789:TEST-token-for-unit-tests-only';
const NOW = 1_790_000_000;

async function signed(fields: Record<string, string | number>, token = TOKEN) {
  const asText = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)]));
  return { ...fields, hash: await signLoginWidget(asText, token) };
}

Deno.test('эталон: подпись совпадает с посчитанной независимо (Python, hashlib)', async () => {
  const hash = await signLoginWidget({ id: '42', first_name: 'Test', username: 'tester', auth_date: '1790000000' }, TOKEN);
  assertEquals(hash, '518f5bc5b378d1b458b94a950dbb76a115791502067964526c6ee0cbe2acd953');
});

Deno.test('правильные данные принимаются; id числом, как присылает Telegram', async () => {
  const data = await signed({ id: 42, first_name: 'Тест', last_name: 'Пользователь', auth_date: NOW - 5, photo_url: 'https://t.me/i/userpic/320/x.jpg' });
  const result = await verifyLoginWidget(data, TOKEN, { now: NOW });
  assertEquals(result.user, { id: 42, first_name: 'Тест', last_name: 'Пользователь' });
  assertEquals(result.startParam, null);
});

Deno.test('чужой токен, подменённое поле, лишнее поле — bad_signature', async () => {
  const foreign = await signed({ id: 42, auth_date: NOW }, '987654321:OTHER');
  assertEquals((await assertRejects(() => verifyLoginWidget(foreign, TOKEN, { now: NOW }), InitDataInvalid)).code, 'bad_signature');
  const good = await signed({ id: 42, auth_date: NOW });
  assertEquals((await assertRejects(() => verifyLoginWidget({ ...good, id: 43 }, TOKEN, { now: NOW }), InitDataInvalid)).code, 'bad_signature');
  assertEquals((await assertRejects(() => verifyLoginWidget({ ...good, role: 'owner' }, TOKEN, { now: NOW }), InitDataInvalid)).code, 'bad_signature');
});

Deno.test('старше часа — expired; из будущего — from_future', async () => {
  const old = await signed({ id: 42, auth_date: NOW - 3601 });
  assertEquals((await assertRejects(() => verifyLoginWidget(old, TOKEN, { now: NOW }), InitDataInvalid)).code, 'expired');
  const future = await signed({ id: 42, auth_date: NOW + 120 });
  assertEquals((await assertRejects(() => verifyLoginWidget(future, TOKEN, { now: NOW }), InitDataInvalid)).code, 'from_future');
});

Deno.test('мусор и вложенные объекты — malformed', async () => {
  for (const input of [null, 'строка', [], {}, { id: 1, hash: 'x' }, { id: { $gt: 0 }, hash: 'a'.repeat(64) }, { ID: 1, hash: 'a'.repeat(64) }]) {
    assertEquals((await assertRejects(() => verifyLoginWidget(input, TOKEN, { now: NOW }), InitDataInvalid)).code, 'malformed');
  }
});

Deno.test('ключ __proto__ не ломает проверку — просто неверная подпись', async () => {
  const good = await signed({ id: 42, auth_date: NOW });
  const input = JSON.parse(`{"__proto__":"x","id":42,"auth_date":${NOW},"hash":"${good.hash}"}`);
  assertEquals((await assertRejects(() => verifyLoginWidget(input, TOKEN, { now: NOW }), InitDataInvalid)).code, 'bad_signature');
});
