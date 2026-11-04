// API /api/stats, action « ads » — lit analytics/ads/{jour} avec un faux Firebase
// (aucun accès réseau, aucun secret).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const DAY = 864e5;
const day = (offset) => new Date(Date.now() - offset * DAY).toISOString().slice(0, 10);

function load(adsData, cspData = {}) {
  const fbPath = require.resolve(path.join(__dirname, '..', 'api', '_lib', 'fb.js'));
  const reads = [];
  const database = {
    ref: (p) => ({
      orderByKey: () => ({ startAt: (from) => ({ once: async () => { reads.push({ p, from }); const src = p === 'analytics/csp' ? cspData : adsData; return { val: () => Object.fromEntries(Object.entries(src).filter(([k]) => k >= from)) }; } }) })
    })
  };
  require.cache[fbPath] = { id: fbPath, filename: fbPath, loaded: true, exports: {
    app: () => ({ database: () => database }),
    verifyAdmin: async () => ({ email: 'admin@example.test' }),
    bearer: () => 'token',
    listAllAuthUsers: async () => []
  } };
  const statsPath = require.resolve(path.join(__dirname, '..', 'api', 'stats.js'));
  delete require.cache[statsPath];
  return { handler: require(statsPath), reads };
}

async function call(handler, body) {
  let status = 0, json = null;
  const res = { status(code) { status = code; return this; }, json(value) { json = value; return this; } };
  await handler({ method: 'POST', body, headers: {} }, res);
  return { status, json };
}

test('ads : totaux par période, taux et série de 90 jours', async () => {
  const { handler, reads } = load({
    [day(0)]: { opened: 10, quick: 4, closed: 1, open: 5 },
    [day(3)]: { opened: 20, quick: 5, closed: 5, open: 10 },
    [day(20)]: { opened: 30, quick: 3, closed: 3, open: 24 },
    [day(200)]: { opened: 999, quick: 999, closed: 0, open: 0 } // hors fenêtre : filtré par startAt
  });
  const { status, json } = await call(handler, { action: 'ads' });
  assert.equal(status, 200);
  assert.equal(reads[0].p, 'analytics/ads');
  assert.equal(json.daily.length, 90);
  assert.equal(json.daily.at(-1).bucket, day(0));
  assert.deepEqual(json.periods.d7, { opened: 30, quick: 9, closed: 6, open: 15, quickRate: 30, closedRate: 20, openRate: 50 });
  assert.equal(json.periods.d30.opened, 60);
  assert.equal(json.periods.d90.opened, 60);
});

test('ads : sans donnée, les totaux sont à zéro et les taux nuls', async () => {
  const { handler } = load({});
  const { json } = await call(handler, { action: 'ads' });
  assert.deepEqual(json.periods.d30, { opened: 0, quick: 0, closed: 0, open: 0, quickRate: null, closedRate: null, openRate: null });
});

test('ads : valeurs invalides ignorées (négatives ou non numériques)', async () => {
  const { handler } = load({ [day(1)]: { opened: -5, quick: 'x', closed: 2, open: null } });
  const { json } = await call(handler, { action: 'ads' });
  assert.deepEqual(json.periods.d7, { opened: 0, quick: 0, closed: 2, open: 0, quickRate: null, closedRate: null, openRate: null });
});

test('ads : domaines bloqués par la CSP sur 7 jours, agrégés et triés', async () => {
  const { handler } = load({}, {
    [day(0)]: { _n: 5, 'script-src-elem': { 'ads,example,net': 3 }, 'connect-src': { 'beacon,example,org': 1 } },
    [day(2)]: { _n: 2, 'script-src-elem': { 'ads,example,net': 2 } },
    [day(9)]: { _n: 50, 'script-src-elem': { 'old,example,com': 50 } } // hors 7 jours
  });
  const { json } = await call(handler, { action: 'ads' });
  assert.deepEqual(json.blocked, [
    { directive: 'script-src-elem', host: 'ads.example.net', count: 5 },
    { directive: 'connect-src', host: 'beacon.example.org', count: 1 }
  ]);
});

test('analytics : répartition des visiteurs uniques par appareil sur 30 jours', async () => {
  const visits = {
    [day(0)]: { u1: { n: 2, platform: 'android_app' }, u2: { n: 1, platform: 'ios' }, u3: { n: 1 } },
    [day(5)]: { u1: { n: 1, platform: 'android_web' }, u4: { n: 1, platform: 'desktop' } }, // u1 : la plus récente prime
    [day(60)]: { u5: { n: 1, platform: 'ios' } } // hors 30 jours
  };
  const fbPath = require.resolve(path.join(__dirname, '..', 'api', '_lib', 'fb.js'));
  const snap = (val) => ({ val: () => val, forEach: () => {} });
  const database = { ref: (p) => ({ once: async () => snap(p === 'analytics/visits' ? visits : p === 'activity_feed' ? {} : {}), limitToLast: () => ({ once: async () => snap({}) }) }) };
  require.cache[fbPath] = { id: fbPath, filename: fbPath, loaded: true, exports: { app: () => ({ database: () => database }), verifyAdmin: async () => ({ email: 'admin@example.test' }), bearer: () => 'token', listAllAuthUsers: async () => [] } };
  const statsPath = require.resolve(path.join(__dirname, '..', 'api', 'stats.js'));
  delete require.cache[statsPath];
  const { json } = await call(require(statsPath), { action: 'analytics' });
  assert.deepEqual(json.platforms, { android_app: 1, android_web: 0, ios: 1, desktop: 1, inconnu: 1 }); // u1 : sa visite la plus récente (aujourd'hui) est l'application
});
