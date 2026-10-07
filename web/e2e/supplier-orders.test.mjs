// ПСТ-2: браузерная проверка заказов поставщикам на production-сборке. Ответы сервера вымышлены;
// настоящие права проверяет supabase/tests/supplier_orders_test.sql.
// Главное, что проверяем глазами: у сотрудника зала нигде нет денег, а заказ ведётся по шагам.
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4174';
const base = `${origin}/CRM-Auron/`;
const orgId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const supplierId = '40000000-0000-4000-8000-000000000001';
const orderId = '50000000-0000-4000-8000-000000000001';
const lateId = '50000000-0000-4000-8000-000000000002';
const newId = '50000000-0000-4000-8000-000000000003';
const milkId = '30000000-0000-4000-8000-000000000001';
const cheeseId = '30000000-0000-4000-8000-000000000002';

const products = [
  { id: milkId, name: 'Молоко 3,2%', cash_code: '101', group_id: null, article: null, unit: 'pcs',
    is_weighted: false, retail_price: 9900, in_stock: true, arrival_on: null, product_barcodes: [], product_photos: [] },
  { id: cheeseId, name: 'Сыр Российский', cash_code: '5940', group_id: null, article: null, unit: 'kg',
    is_weighted: true, retail_price: 89900, in_stock: true, arrival_on: null, product_barcodes: [], product_photos: [] },
];

const row = (over = {}) => ({
  id: orderId, supplier_id: supplierId, supplier_name: 'ООО Молочный опт', status: 'created',
  expected_at: '2026-10-09', created_at: '2026-10-07T06:00:00Z', items: 2,
  amount: 152925, amount_actual: null, no_price: 0, overdue: false, ...over,
});

const items = () => ([
  { id: 'i1', product_id: milkId, name: 'Молоко 3,2%', cash_code: '101', unit: 'pcs', qty: 6, price: 8000, sum: 48000 },
  { id: 'i2', product_id: cheeseId, name: 'Сыр Российский', cash_code: '5940', unit: 'kg', qty: 1.5, price: 69950, sum: 104925 },
]);

const full = (over = {}) => ({
  money: true, id: orderId, supplier_id: supplierId, supplier_name: 'ООО Молочный опт', status: 'created',
  expected_at: '2026-10-09', created_at: '2026-10-07T06:00:00Z', confirmed_at: null, closed_at: null,
  note: 'Привезти до обеда', who: 'Пётр Кладовщик', amount: 152925, amount_actual: null, items: items(), ...over,
});

let browser;
let server;

before(async () => {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], { stdio: 'pipe' });
  for (let i = 0; i < 100; i++) {
    if (await fetch(base).then((r) => r.ok).catch(() => false)) break;
    if (i === 99) throw new Error('Тестовый сайт не запустился');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.WAYMARKET_CHROMIUM ? { executablePath: process.env.WAYMARKET_CHROMIUM } : {}) });
  await mkdir('test-results/supplier-orders', { recursive: true });
});
after(async () => { await browser?.close(); server?.kill(); });

async function withPage(options, run) {
  const { role = 'owner', aal = 'aal2', width = 390 } = options;
  const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
  const state = { errors: [], violations: [], order: full(), statusCalls: [], itemCalls: [], createCalls: [], marks: [] };
  const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'demo@test.invalid',
    app_metadata: { telegram_id: 123456789 }, user_metadata: {}, factors: [{ id: 'test-factor', status: 'verified', factor_type: 'totp' }] };
  const encode = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const session = { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, role: 'authenticated', aal, exp })}.test-signature`,
    refresh_token: 'test-refresh-only', token_type: 'bearer', expires_at: exp, expires_in: 3600, user };
  await context.addInitScript(({ session }) => {
    localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', (event) => window.__violations.push(event.violatedDirective));
  }, { session });

  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.hostname === 'telegram.org') return route.fulfill({ contentType: 'application/javascript', body: '// Тестовый SDK уже установлен.' });
    if (url.hostname !== 'example.supabase.co') return route.abort();
    const reply = (data, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': origin, 'access-control-expose-headers': 'content-range', ...headers },
      body: route.request().method() === 'HEAD' ? '' : JSON.stringify(data) });
    const body = () => route.request().postDataJSON() ?? {};
    const money = role !== 'staff';

    if (url.pathname === '/auth/v1/health') return reply({});
    if (url.pathname === '/auth/v1/user') return reply(user);
    if (url.pathname === '/functions/v1/auth-telegram') return reply({ botId: 123456789 });
    if (url.pathname.endsWith('/profiles')) return reply({ full_name: 'Тестовый участник' });
    if (url.pathname.endsWith('/memberships')) return reply([{ org_id: orgId, role, organizations: { name: 'Тестовый магазин' } }]);
    if (url.pathname.endsWith('/organizations')) return reply({ id: orgId, name: 'Тестовый магазин' });
    if (url.pathname.endsWith('/instance_info')) return reply({ real_personal_data: false });
    if (url.pathname.endsWith('/suppliers')) return reply([{ id: supplierId, name: 'ООО Молочный опт', kind: 'ooo', note: null, deleted_at: null, supplier_contacts: [] }]);
    if (url.pathname.endsWith('/product_groups')) return reply([]);
    if (url.pathname.endsWith('/products')) return reply(products, 200, { 'content-range': '0-1/2' });
    if (url.pathname.endsWith('/catalog_version')) return reply('test-version');
    if (url.pathname.endsWith('/restock_marks')) return reply([]);

    if (url.pathname.endsWith('/restock_list')) {
      return reply(state.marks);
    }
    if (url.pathname.endsWith('/supplier_orders_list')) {
      const hide = (o) => (money ? o : { ...o, amount: null, amount_actual: null });
      return reply({
        money,
        orders: [
          hide(row({ ...state.order, items: 2, no_price: 0, overdue: false })),
          hide(row({ id: lateId, supplier_name: 'ИП Вымышленный пекарь', expected_at: '2026-10-01',
            amount: 40000, overdue: true, items: 1, no_price: 1 })),
        ],
        days: [
          { date: '2026-10-01', orders: 1, amount: money ? 40000 : null, overdue: true },
          { date: '2026-10-09', orders: 1, amount: money ? 152925 : null, overdue: false },
        ],
        overdue: { orders: 1, amount: money ? 40000 : null },
      });
    }
    if (url.pathname.endsWith('/supplier_order_get')) {
      const o = state.order;
      return reply(money ? o : { ...o, money: false, who: null, amount: null, amount_actual: null,
        items: o.items.map((i) => ({ ...i, price: null, sum: null })) });
    }
    if (url.pathname.endsWith('/supplier_order_status_set')) {
      const p = body();
      state.statusCalls.push(p);
      state.order = { ...state.order, status: p.p_status,
        amount_actual: p.p_status === 'received' ? p.p_amount_actual : state.order.amount_actual };
      return reply({ status: p.p_status });
    }
    if (url.pathname.endsWith('/supplier_order_items_set')) {
      const p = body();
      state.itemCalls.push(p);
      state.order = { ...state.order,
        items: state.order.items.map((i, n) => ({ ...i, qty: p.p_items[n]?.qty ?? i.qty,
          sum: i.price === null ? null : Math.round((p.p_items[n]?.qty ?? i.qty) * i.price) })) };
      return reply({ items: p.p_items.length });
    }
    if (url.pathname.endsWith('/supplier_order_create')) {
      state.createCalls.push(body());
      return reply(newId);
    }
    return reply([]);
  });

  const page = await context.newPage();
  page.on('pageerror', (error) => state.errors.push(error.message));
  try {
    await run(page, state);
    assert.deepEqual(await page.evaluate(() => window.__violations), [], 'CSP не нарушена');
    assert.deepEqual(state.errors, [], 'Нет ошибок JavaScript');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Нет горизонтальной прокрутки');
  } finally {
    await context.close();
  }
}

test('ПСТ-2: владелец видит просрочку, календарь и суммы', async () => {
  await withPage({}, async (page) => {
    await page.goto(`${base}#suppliers`);
    await page.getByRole('button', { name: /Заказы поставщикам/ }).click();
    await page.getByRole('heading', { name: 'Заказы поставщикам', exact: true }).waitFor();
    await page.getByText('Ждали раньше: 1 · 400,00 ₽', { exact: true }).waitFor();
    await page.getByText('01.10.2026', { exact: true }).waitFor();
    await page.getByText('1 поставка · 1 529,25 ₽', { exact: true }).waitFor();
    assert.equal(page.url(), `${base}#suppliers/orders`);
    await page.screenshot({ path: 'test-results/supplier-orders/list-owner.png', fullPage: true });
  });
});

test('ПСТ-2: день календаря отбирает свои заказы, «Все дни» возвращает список', async () => {
  await withPage({}, async (page) => {
    await page.goto(`${base}#suppliers/orders`);
    await page.getByText('Ждали раньше: 1 · 400,00 ₽', { exact: true }).waitFor();
    await page.getByRole('button', { name: /^09\.10\.2026/ }).click();
    // Ждём, а не замеряем: count() не дожидается перерисовки, и на медленной машине
    // замер попадал бы в момент до неё.
    await page.getByRole('button', { name: /ИП Вымышленный пекарь/ }).waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: /ООО Молочный опт/ }).waitFor();
    await page.getByRole('button', { name: 'Все дни', exact: true }).click();
    await page.getByRole('button', { name: /ИП Вымышленный пекарь/ }).waitFor();
  });
});

test('ПСТ-2: заказ ведётся по шагам — количество, подтверждение, приёмка с фактической суммой', async () => {
  await withPage({}, async (page, state) => {
    await page.goto(`${base}#suppliers/orders/${orderId}`);
    await page.getByRole('heading', { name: 'ООО Молочный опт', exact: true }).waitFor();
    await page.getByText('Код 101 · 6 шт · 80,00 ₽ · 480,00 ₽', { exact: true }).waitFor();
    await page.getByText('Код 5940 · 1,5 кг · 699,50 ₽ · 1 049,25 ₽', { exact: true }).waitFor();
    await page.getByText('Пётр Кладовщик', { exact: true }).waitFor();
    await page.screenshot({ path: 'test-results/supplier-orders/card-owner.png', fullPage: true });

    // Весовой товар шагает по 100 г, а не по килограмму.
    const cheese = page.getByLabel('Количество: Сыр Российский');
    await cheese.getByRole('button', { name: 'Больше' }).click();
    await page.getByText('Код 5940 · 1,6 кг', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Сохранить количество', exact: true }).click();
    await page.getByText('Количество сохранено', { exact: true }).waitFor();
    assert.equal(state.itemCalls.length, 1);
    assert.deepEqual(state.itemCalls[0].p_items.map((i) => i.qty), [6, 1.6]);

    await page.getByRole('button', { name: 'Поставщик подтвердил', exact: true }).click();
    await page.getByRole('button', { name: 'Принять поставку', exact: true }).waitFor();
    await page.getByText('Подтверждён поставщиком', { exact: true }).first().waitFor();
    // Состав заморожен: сначала дожидаемся подписи об этом, потом проверяем, что шагов нет.
    await page.getByText('Состав меняют, пока поставщик не подтвердил заказ.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Больше' }).count(), 0);

    page.once('dialog', (dialog) => void dialog.accept('15 400,50'));
    await page.getByRole('button', { name: 'Принять поставку', exact: true }).click();
    await page.getByText('По факту', { exact: true }).waitFor();
    await page.getByText('15 400,50 ₽', { exact: true }).waitFor();
    assert.deepEqual(state.statusCalls.map((c) => [c.p_status, c.p_amount_actual]),
      [['confirmed', null], ['received', 1540050]]);
    // Принятый заказ закрыт: действий больше не предлагаем.
    assert.equal(await page.getByRole('button', { name: 'Отменить заказ' }).count(), 0);
    await page.screenshot({ path: 'test-results/supplier-orders/card-received.png', fullPage: true });
  });
});

test('ПСТ-2: сотруднику зала нигде не видно денег и нет действий', async () => {
  await withPage({ role: 'staff', aal: 'aal1' }, async (page) => {
    await page.goto(`${base}#suppliers/orders`);
    await page.getByText('Ждали раньше: 1', { exact: true }).waitFor();
    assert.equal(await page.getByText('₽').count(), 0, 'в списке нет ни одной суммы');
    await page.getByRole('button', { name: /ООО Молочный опт/ }).first().click();
    await page.getByRole('heading', { name: 'ООО Молочный опт', exact: true }).waitFor();
    await page.getByText('Код 101 · 6 шт', { exact: true }).waitFor();
    assert.equal(await page.getByText('₽').count(), 0, 'в карточке нет ни одной суммы');
    assert.equal(await page.getByRole('button', { name: 'Поставщик подтвердил' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Отменить заказ' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Больше' }).count(), 0);
    await page.screenshot({ path: 'test-results/supplier-orders/card-staff.png', fullPage: true });
  });
});

test('ПСТ-2: из списка «Закончилось на полке» заказ оформляется одним нажатием', async () => {
  await withPage({ role: 'staff', aal: 'aal1' }, async (page, state) => {
    state.marks = [
      { id: 'm1', product_id: milkId, name: 'Молоко 3,2%', cash_code: '101', unit: 'pcs',
        created_at: '2026-10-07T05:00:00Z', ordered_at: null, who: null,
        supplier_id: supplierId, supplier_name: 'ООО Молочный опт' },
      { id: 'm2', product_id: cheeseId, name: 'Сыр Российский', cash_code: '5940', unit: 'kg',
        created_at: '2026-10-07T05:10:00Z', ordered_at: null, who: null, supplier_id: null, supplier_name: null },
    ];
    await page.goto(`${base}#catalog/restock`);
    await page.getByRole('heading', { name: 'ООО Молочный опт', exact: true }).waitFor();
    // У товара без поставщика заказ не оформить — и об этом сказано, а не просто нет кнопки.
    await page.getByText('Без поставщика заказ не оформить: укажите поставщика в карточке товара.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Оформить заказ поставщику', exact: true }).count(), 1);
    await page.screenshot({ path: 'test-results/supplier-orders/restock-staff.png', fullPage: true });
    await page.getByRole('button', { name: 'Оформить заказ поставщику', exact: true }).click();
    await page.waitForURL(`${base}#suppliers/orders/${newId}`);
    await page.getByRole('heading', { name: 'Состав заказа', exact: true }).waitFor();
    assert.equal(state.createCalls.length, 1);
    assert.deepEqual(state.createCalls[0].p_items, [{ product_id: milkId, qty: 1 }]);
    assert.deepEqual(state.createCalls[0].p_marks, ['m1']);
  });
});
