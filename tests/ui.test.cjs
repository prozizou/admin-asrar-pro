const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
let playwright;
try { playwright = require('playwright'); } catch (error) {
  if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw error;
  playwright = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright'));
}
const fixtures = require('./fixtures.cjs');
const root = path.resolve(__dirname, '..');
let browser, server, baseURL;
before(async () => {
  server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const filename = path.join(root, pathname === '/' ? 'index.html' : pathname);
    if (!filename.startsWith(root + path.sep)) { response.writeHead(403); return response.end(); }
    if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) { response.writeHead(404); return response.end(); }
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' })[path.extname(filename)] || 'text/plain');
    response.end(fs.readFileSync(filename));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseURL = 'http://127.0.0.1:' + server.address().port;
  browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.UI_CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });
async function openPage({ width = 1440, signedIn = true, denied = false, fail = false, empty = false, reducedMotion = 'no-preference', storageBlocked = false, slowModule = false, hash = '' } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width > 820 ? 1000 : 844 }, serviceWorkers: 'block', reducedMotion });
  const page = await context.newPage();
  const errors = [];
  const writes = [];
  let failed = fail;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ signedIn, storageBlocked }) => {
    if (storageBlocked) Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
    const user = signedIn ? { displayName: 'Admin Démo', email: 'admin@example.com', getIdToken: async () => 'synthetic-test-token' } : null;
    let listener;
    const auth = { setPersistence: async () => {}, getRedirectResult: async () => {}, onAuthStateChanged: fn => { listener = fn; setTimeout(() => fn(user), 0); }, onIdTokenChanged: fn => setTimeout(() => fn(user), 0), signOut: async () => listener(null), signInWithPopup: async () => {}, signInWithRedirect: async () => {} };
    const factory = () => auth;
    factory.Auth = { Persistence: { LOCAL: 'local', SESSION: 'session' } };
    factory.GoogleAuthProvider = class { setCustomParameters() {} };
    window.firebase = { initializeApp() {}, auth: factory };
  }, { signedIn, storageBlocked });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== baseURL) return route.abort();
    if (slowModule && url.pathname === '/admin-market.js') await new Promise(resolve => setTimeout(resolve, 250));
    if (url.pathname === '/api/config') return route.fulfill({ contentType: 'application/javascript', body: 'window.FIREBASE_CONFIG={apiKey:"test",projectId:"test"};window.SITE_URL="https://example.com";' });
    if (url.pathname.startsWith('/api/')) {
      const payload = route.request().postDataJSON() || {};
      const endpoint = url.pathname.split('/').pop();
      if (!['overview', 'analytics', 'list', 'nodes', 'list_access', 'list_minutes'].includes(payload.action)) writes.push({ endpoint, action: payload.action });
      if (denied) return route.fulfill({ status: 403, json: { error: 'Forbidden test account' } });
      if (failed && endpoint === 'stats') return route.fulfill({ status: 503, json: { error: 'Service temporairement indisponible.' } });
      if (empty && endpoint === 'stats' && payload.action === 'overview') return route.fulfill({ json: { kpis: {}, spark: [], countryBreakdown: [], recent: [] } });
      return route.fulfill({ json: fixtures.response(endpoint, payload.action, payload) });
    }
    return route.continue();
  });
  await page.goto(baseURL + '/' + hash);
  await page.locator(signedIn && !denied ? '#app' : '#loginBox').waitFor({ state: 'visible' });
  if (signedIn && !denied) await page.locator('#pageHeading').waitFor();
  return { page, context, errors, writes, recover: () => { failed = false; } };
}
async function noOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(dimensions.scroll <= dimensions.width + 1, label + ': horizontal overflow ' + JSON.stringify(dimensions));
}
async function capture(page, name, fullPage = true) {
  if (!process.env.UI_CAPTURE_DIR) return;
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    if (document.getElementById('fixtureNotice')) return;
    const notice = document.createElement('div'); notice.id = 'fixtureNotice';
    notice.textContent = 'APERÇU · DONNÉES DE DÉMONSTRATION';
    notice.style.cssText = 'position:fixed;bottom:78px;right:14px;background:#153f35;color:white;border:1px solid #91ac91;border-radius:5px;padding:5px 8px;font:8px system-ui;z-index:15000;pointer-events:none;letter-spacing:1px';
    document.body.appendChild(notice);
  });
  fs.mkdirSync(process.env.UI_CAPTURE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.UI_CAPTURE_DIR, name + '.png'), fullPage, animations: 'disabled' });
}

test('Desktop: dashboard, exact chart windows, navigation, history, search, theme, editor focus', async () => {
  const { page, context, errors, writes } = await openPage();
  try {
    await page.locator('#dashGrid .stat').first().waitFor();
    assert.equal(await page.locator('#dashGrid .stat').count(), 4);
    assert.match(await page.locator('#dashGrid').innerText(), /Valeur des accès/);
    assert.match(await page.locator('#accountName').innerText(), /Admin Démo/);
    await noOverflow(page, 'desktop dashboard');
    await capture(page, 'dashboard-desktop');
    await page.locator('#dashPeriodSeg [data-period="30"]').click();
    assert.equal(await page.locator('#dashPeriodSeg [data-period="30"]').getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('#dashTrafficSummary').innerText(), /30 jours/);
    await page.locator('.chart-data summary').click();
    assert.equal(await page.locator('.chart-data tbody tr').count(), 5);
    for (const tab of ['users', 'content', 'market', 'fonts', 'referral', 'analytics']) {
      await page.locator('#mainNav [data-tab="' + tab + '"]').click();
      await page.locator('#tab-' + tab).waitFor({ state: 'visible' });
      await noOverflow(page, 'desktop ' + tab);
    }
    await page.goBack();
    await page.locator('#tab-referral').waitFor({ state: 'visible' });
    await page.keyboard.press('Control+k');
    await page.locator('#commandInput').fill('utilisa');
    await page.keyboard.press('Enter');
    await page.locator('#tab-users').waitFor({ state: 'visible' });
    await page.locator('.access-card').first().waitFor();
    await capture(page, 'users-desktop');
    await page.locator('#btnOpenGrant').click();
    assert.equal(await page.locator('#gaEmail').evaluate(el => el === document.activeElement), true);
    assert.equal(await page.locator('#app').evaluate(el => el.inert), true);
    await page.locator('#btnSubmitGa').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#btnCancelBig').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    await page.locator('#big').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#app').evaluate(el => el.inert), false);
    await page.locator('#mainNav [data-tab="dashboard"]').click();
    await page.locator('#pagePrimaryAction').click();
    await page.locator('[data-create="secret"]').click();
    await page.locator('#secFaida').waitFor();
    assert.match(await page.locator('#editorTitle').innerText(), /Nouveau secret/);
    await page.locator('#btnCancelBig').click();
    await page.locator('#themeToggle').click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await capture(page, 'dashboard-dark');
    await page.reload();
    await page.locator('#app').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await page.locator('#btnLogout').click();
    await page.locator('#loginBox').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#app').isVisible(), false);
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
  } finally { await context.close(); }
});

test('Mobile and tablet: every section fits, drawer and bottom navigation, content drill-down', async () => {
  for (const width of [360, 390, 768, 1024]) {
    const { page, context, errors } = await openPage({ width });
    try {
      await page.locator('#dashGrid .stat').first().waitFor();
      await noOverflow(page, width + ' dashboard');
      if (width === 390) await capture(page, 'dashboard-mobile', false);
      for (const tab of ['content', 'users', 'market', 'fonts', 'referral', 'analytics']) {
        if (width <= 820) {
          await page.locator('#moreNav').click();
          assert.equal(await page.locator('#mainContent').evaluate(el => el.inert), true);
        }
        await page.locator('#mainNav [data-tab="' + tab + '"]').click();
        await page.locator('#tab-' + tab).waitFor({ state: 'visible' });
        assert.equal(await page.locator('#mainContent').evaluate(el => el.inert), false);
        await noOverflow(page, width + ' ' + tab);
        if (tab === 'content') {
          await page.locator('[data-node="db_sirr_ouverture"]').click();
          await page.locator('.card').first().waitFor();
          await noOverflow(page, width + ' content cards');
          if (width === 390) await capture(page, 'content-mobile');
          if (width <= 820) await page.locator('#btnBackNodes').click();
        }
        if (tab === 'users') {
          await page.locator('#btnOpenGrant').click();
          await noOverflow(page, width + ' grant dialog');
          await page.locator('#btnCancelBig').click();
        }
      }
      if (width <= 820) {
        await page.locator('#moreNav').click();
        await page.locator('#closeNav').press('Shift+Tab');
        assert.equal(await page.locator('#btnLogout').evaluate(el => el === document.activeElement), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#moreNav').getAttribute('aria-expanded'), 'false');
      }
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

test('Failure and retry, empty data, anonymous and rejected accounts', async () => {
  const failed = await openPage({ fail: true });
  try {
    await failed.page.locator('#retryDashboard').waitFor();
    failed.recover();
    await failed.page.locator('#retryDashboard').click();
    await failed.page.locator('#dashGrid .stat').first().waitFor();
    assert.deepEqual(failed.errors, []);
  } finally { await failed.context.close(); }
  for (const options of [{ empty: true }, { signedIn: false }, { denied: true }, { storageBlocked: true, slowModule: true, reducedMotion: 'reduce' }]) {
    const { page, context, errors } = await openPage({ width: 390, ...options });
    try {
      if (options.empty) {
        await page.getByText('Aucune visite enregistrée sur cette période.').waitFor();
        assert.equal(await page.locator('.traffic-chart').count(), 0);
      }
      if (options.signedIn === false || options.denied) {
        assert.equal(await page.locator('#app').isVisible(), false);
        if (!options.denied) await capture(page, 'login-mobile');
      }
      await noOverflow(page, JSON.stringify(options));
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});
