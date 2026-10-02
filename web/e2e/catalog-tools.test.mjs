// КАТ-6: браузерная проверка production-сборки. Все ответы сервера и учётки вымышлены.
// Проверки настоящих RLS находятся в supabase/tests/catalog_tools_test.sql.
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4173';
const base = `${origin}/CRM-Auron/`;
const orgId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const productId = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const products = Array.from({ length: 54 }, (_, i) => ({
  id: productId(i + 1), name: `Тестовый товар ${String(i + 1).padStart(2, '0')}`, cash_code: String(i + 1),
  group_id: null, article: null, unit: 'pcs', is_weighted: false,
  retail_price: i === 0 ? 9900 : i === 1 ? 10000 : null,
  in_stock: true, arrival_on: null, product_barcodes: [], product_photos: [],
}));
const issue = (p, barcode = null) => ({
  id: p.id, name: p.name, cash_code: p.cash_code, unit: p.unit,
  retail_price: p.retail_price === null ? null : String(p.retail_price), purchase_price: '10000',
  barcode, barcode_count: barcode ? 2 : null,
});
const counts = { missing_price: 52, below_cost: 1, no_markup: 1, duplicate_barcodes: 1, price_rise: 1, bestsellers: 1 };
const salesPeriod = { from: '2026-09-01', to: '2026-09-30' };
let browser;
let server;

before(async () => {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: 'pipe' });
  for (let i = 0; i < 100; i++) {
    if (await fetch(base).then((r) => r.ok).catch(() => false)) break;
    if (i === 99) throw new Error('Тестовый сайт не запустился');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.WAYMARKET_CHROMIUM ? { executablePath: process.env.WAYMARKET_CHROMIUM } : {}) });
  await mkdir('test-results/catalog-tools', { recursive: true });
});
after(async () => { await browser?.close(); server?.kill(); });

async function withPage(options, run) {
  const { role = 'owner', aal = 'aal2', width = 390, dark = false, telegram = false } = options;
  const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: dark ? 'dark' : 'light', serviceWorkers: 'block' });
  const state = { mode: 'ok', calls: [], violations: [], errors: [] };
  const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'demo@test.invalid',
    app_metadata: { telegram_id: 123456789 }, user_metadata: {}, factors: [{ id: 'test-factor', status: 'verified', factor_type: 'totp' }] };
  const encode = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const session = { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, role: 'authenticated', aal, exp })}.test-signature`,
    refresh_token: 'test-refresh-only', token_type: 'bearer', expires_at: exp, expires_in: 3600, user };
  await context.addInitScript(({ session, role, telegram, dark }) => {
    if (role !== 'guest') localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', (event) => window.__violations.push(event.violatedDirective));
    if (telegram) {
      sessionStorage.setItem('__telegram__initParams', '{}');
      window.Telegram = { WebApp: { initData: 'test-launch', initDataUnsafe: { user: { id: 123456789 } },
        colorScheme: dark ? 'dark' : 'light', themeParams: {}, ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} } } };
    }
  }, { session, role, telegram, dark });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.hostname === 'telegram.org') return route.fulfill({ contentType: 'application/javascript', body: '// Тестовый SDK уже установлен.' });
    if (url.hostname !== 'example.supabase.co') return route.abort();
    const reply = (data, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json',
      // Как настоящий Supabase: без expose-headers браузер не видит content-range и считает каталог пустым.
      headers: { 'access-control-allow-origin': origin, 'access-control-expose-headers': 'content-range', ...headers },
      body: route.request().method() === 'HEAD' ? '' : JSON.stringify(data) });
    if (url.pathname === '/auth/v1/health') return reply({});
    if (url.pathname === '/auth/v1/user') return reply(user);
    if (url.pathname === '/functions/v1/auth-telegram') return reply({ botId: 123456789 });
    if (url.pathname.endsWith('/profiles')) return reply({ full_name: 'Тестовый участник' });
    if (url.pathname.endsWith('/memberships')) return reply([{ org_id: orgId, role, organizations: { name: 'Тестовый магазин' } }]);
    if (url.pathname.endsWith('/organizations')) return reply({ id: orgId, name: 'Тестовый магазин' });
    if (url.pathname.endsWith('/product_groups')) return reply([]);
    if (url.pathname.endsWith('/products')) return reply(products, 200, { 'content-range': `0-53/54` });
    if (url.pathname.endsWith('/product_internals')) return reply({ purchase_price: 10000, stock: 1, note: null });
    if (url.pathname.endsWith('/price_history')) return reply([]);
    if (url.pathname.endsWith('/catalog_version')) return reply('test-version');
    if (url.pathname.endsWith('/catalog_issues')) {
      const params = route.request().postDataJSON();
      state.calls.push(params);
      if (state.mode === 'denied') return reply({ code: '42501', message: 'Нет доступа' }, 403);
      if (state.mode === 'offline') return route.abort('internetdisconnected');
      const rows = params.p_kind === 'missing_price' ? products.slice(2).map((p) => issue(p))
        : params.p_kind === 'below_cost' ? [issue(products[0])]
          : params.p_kind === 'no_markup' ? [issue(products[1])]
            : params.p_kind === 'price_rise' ? [{ ...issue(products[0]), price_kind: 'purchase', old_price: '8000', new_price: '10000',
              changed_at: '2026-10-01T09:00:00+00:00' }]
              : params.p_kind === 'bestsellers' ? [{ ...issue(products[1]), qty: '3.500', amount: '35000' }]
                : products.slice(0, 2).map((p) => issue(p, '4600000000011'));
      return reply({ counts, total: rows.length, sales_period: salesPeriod, items: rows.slice(params.p_offset, params.p_offset + params.p_limit) });
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

test('КАТ-6: каталог → инструменты → убыток → карточка → тот же фильтр', async () => {
  await withPage({}, async (page) => {
    await page.goto(`${base}#catalog`);
    await page.getByRole('button', { name: /Инструменты Цены/ }).click();
    await page.getByRole('button', { name: /^Ниже закупки/ }).click();
    await page.getByText('Закупка: 100,00', { exact: false }).waitFor();
    await page.getByRole('button', { name: /Тестовый товар 01/ }).click();
    await page.getByRole('heading', { name: 'Тестовый товар 01' }).waitFor();
    await page.getByRole('button', { name: 'Ниже закупки', exact: true }).first().click();
    await page.getByRole('heading', { name: 'Ниже закупки', exact: true }).waitFor();
    assert.equal(page.url(), `${base}#catalog/tools/below_cost`);
  });
});

test('КАТ-6: отчёты «Подорожало» и «Ходовые товары»', async () => {
  await withPage({}, async (page) => {
    await page.goto(`${base}#catalog/tools`);
    await page.getByRole('heading', { name: 'Отчёты', exact: true }).waitFor();
    await page.screenshot({ path: 'test-results/catalog-tools/reports-summary.png', fullPage: true });
    await page.getByRole('button', { name: /^Подорожало/ }).click();
    await page.getByText('Закупка: 80,00\u00a0₽ → 100,00\u00a0₽ · ценник 99,00\u00a0₽ · 01.10.2026', { exact: true }).waitFor();
    assert.equal(await page.getByText('+25\u00a0%', { exact: true }).count(), 1);
    await page.screenshot({ path: 'test-results/catalog-tools/reports-price-rise.png', fullPage: true });
    await page.getByRole('button', { name: 'Инструменты', exact: true }).first().click();
    await page.getByRole('button', { name: /^Ходовые товары/ }).click();
    await page.getByText('Продажи за 01.09.2026 – 30.09.2026 по выручке', { exact: false }).waitFor();
    await page.getByText('Код 2 · Продано 3,5 шт.', { exact: true }).waitFor();
    assert.equal(await page.getByText('350,00\u00a0₽', { exact: true }).count(), 1);
    await page.screenshot({ path: 'test-results/catalog-tools/reports-bestsellers.png', fullPage: true });
  });
});

test('КАТ-6: страница списка сохраняется после карточки; закрытые сведения не кэшируются', async () => {
  await withPage({}, async (page, state) => {
    await page.goto(`${base}#catalog/tools/missing_price`);
    await page.getByRole('button', { name: 'Следующие товары' }).click();
    await page.getByRole('button', { name: /Тестовый товар 53/ }).click();
    await page.getByRole('heading', { name: 'Тестовый товар 53' }).waitFor();
    const calls = state.calls.length;
    await page.getByRole('button', { name: 'Без цены', exact: true }).first().click();
    await page.getByRole('button', { name: /Тестовый товар 53/ }).waitFor();
    assert.equal(state.calls.length, calls, 'Назад не сбрасывает страницу и не перезагружает отчёт');
    assert.equal(await page.getByRole('button', { name: /Тестовый товар 03/ }).count(), 0);
    const stored = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open('way-market'); r.onsuccess = () => resolve(r.result); r.onerror = reject; });
      const values = await new Promise((resolve, reject) => { const r = db.transaction('kv').objectStore('kv').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = reject; });
      db.close();
      return JSON.stringify({ values, local: { ...localStorage }, session: { ...sessionStorage } });
    });
    assert.doesNotMatch(stored, /purchasePrice|purchase_price|catalog_issues/);
  });
});

for (const role of ['guest', 'staff', 'supplier', 'customer']) {
  test(`КАТ-6: ${role} не запрашивает инструменты даже по прямой ссылке`, async () => {
    await withPage({ role }, async (page, state) => {
      await page.goto(`${base}#catalog/tools/below_cost`);
      await page.getByText('Инструменты недоступны', { exact: true }).waitFor();
      assert.equal(state.calls.length, 0);
      assert.equal(await page.getByText('Закупка: 100,00', { exact: false }).count(), 0);
    });
  });
}

test('КАТ-6: владельцу без TOTP недоступна прямая ссылка', async () => {
  await withPage({ aal: 'aal1' }, async (page, state) => {
    await page.goto(`${base}#catalog/tools`);
    await page.getByText('Инструменты недоступны', { exact: true }).waitFor();
    assert.equal(state.calls.length, 0);
  });
});

test('КАТ-6: серверный отказ убирает отчёт', async () => {
  await withPage({}, async (page, state) => {
    state.mode = 'denied';
    await page.goto(`${base}#catalog/tools/below_cost`);
    await page.getByText('Инструменты недоступны', { exact: true }).waitFor();
    assert.equal(await page.getByText('По этой проверке замечаний нет').count(), 0);
  });
});

test('КАТ-6: ошибка сети → повтор → результат', async () => {
  await withPage({}, async (page, state) => {
    state.mode = 'offline';
    await page.goto(`${base}#catalog/tools/below_cost`);
    await page.getByRole('button', { name: 'Повторить проверку' }).waitFor();
    state.mode = 'ok';
    await page.getByRole('button', { name: 'Повторить проверку' }).click();
    await page.getByRole('button', { name: /Тестовый товар 01/ }).waitFor();
  });
});

for (const role of ['manager', 'accountant']) {
  test(`КАТ-6: ${role} читает отчёт с TOTP`, async () => {
    await withPage({ role }, async (page) => {
      await page.goto(`${base}#catalog/tools/duplicate_barcodes`);
      await page.getByRole('button', { name: /Тестовый товар 01/ }).waitFor();
      assert.equal(await page.getByText('4600000000011 · товаров: 2', { exact: false }).count(), 2);
    });
  });
}

test('КАТ-6: iOS — 390/1280, светлая/тёмная, браузер/Telegram, CSP', async () => {
  for (const width of [390, 1280]) for (const dark of [false, true]) for (const telegram of [false, true]) {
    await withPage({ width, dark, telegram }, async (page) => {
      await page.goto(`${base}#catalog/tools/below_cost`);
      await page.getByRole('button', { name: /Тестовый товар 01/ }).waitFor();
      await page.screenshot({ path: `test-results/catalog-tools/${width}-${dark ? 'dark' : 'light'}-${telegram ? 'telegram' : 'browser'}.png`, fullPage: true });
    });
  }
});
