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
  const database = { ref: (p) => ({ once: async () => snap(p === 'analytics/visits' ? visits : p === 'activity_feed' ? {} : {}), limitToLast: () => ({ once: async () => snap({}) }), orderByKey: () => ({ startAt: () => ({ once: async () => snap({}) }) }) }) };
  require.cache[fbPath] = { id: fbPath, filename: fbPath, loaded: true, exports: { app: () => ({ database: () => database }), verifyAdmin: async () => ({ email: 'admin@example.test' }), bearer: () => 'token', listAllAuthUsers: async () => [] } };
  const statsPath = require.resolve(path.join(__dirname, '..', 'api', 'stats.js'));
  delete require.cache[statsPath];
  const { json } = await call(require(statsPath), { action: 'analytics' });
  assert.deepEqual(json.platforms, { android_app: 1, android_web: 0, ios: 1, desktop: 1, inconnu: 1 }); // u1 : sa visite la plus récente (aujourd'hui) est l'application
});

// Fausse base générique : données par chemin, orderByKey().startAt() filtré.
function loadWith(data) {
  const fbPath = require.resolve(path.join(__dirname, '..', 'api', '_lib', 'fb.js'));
  const snap = (val) => ({ val: () => (val === undefined ? null : val), forEach: () => {} });
  const at = (p) => p.split('/').reduce((v, k) => (v == null ? undefined : v[k]), data);
  const database = { ref: (p = '') => ({
    update: async (patch) => { for (const [k, v] of Object.entries(patch)) { const keys = (p ? p + '/' + k : k).split('/'); let node = data; for (const key of keys.slice(0, -1)) node = node[key] ??= {}; if (v === null) delete node[keys.at(-1)]; else node[keys.at(-1)] = v; } },
    push: async () => {},
    once: async () => snap(at(p)),
    limitToLast: () => ({ once: async () => snap(at(p)) }),
    orderByKey: () => ({ startAt: (from) => ({ once: async () => snap(Object.fromEntries(Object.entries(at(p) || {}).filter(([k]) => k >= from))) }) })
  }) };
  require.cache[fbPath] = { id: fbPath, filename: fbPath, loaded: true, exports: { app: () => ({ database: () => database }), verifyAdmin: async () => ({ email: 'admin@example.test' }), bearer: () => 'token', listAllAuthUsers: async () => [], audit: async () => {} } };
  const statsPath = require.resolve(path.join(__dirname, '..', 'api', 'stats.js'));
  delete require.cache[statsPath];
  return require(statsPath);
}

test('overview : compteurs anonymes de tous les comptes (visites, pays avec nom français)', async () => {
  const month = day(0).slice(0, 7);
  const handler = loadWith({
    analytics: {
      daily: { [day(0)]: { visits: 12, unique: 9 }, [day(1)]: { visits: 5, unique: 4 } },
      geo: { [month]: { SN: 6, CI: 3, XX: 1 } }
    },
    // Ancien relevé (sans pays, compte non consentant) : remplacé par les compteurs anonymes.
    user_sessions: { a: { lastLoginAt: Date.now() } }
  });
  const { json } = await call(handler, { action: 'overview' });
  assert.equal(json.error, undefined);
  assert.equal(json.kpis.visitsToday, 12);
  assert.equal(json.kpis.uniqueToday, 9);
  assert.equal(json.kpis.visits30, 17);
  assert.equal(json.spark.at(-1).total, 12);
  assert.equal(json.audienceAnonymous, true);
  assert.equal(json.countryPeriod, month);
  assert.deepEqual(json.countryBreakdown.map((c) => [c.countryCode, c.users, c.pct]), [['SN', 6, 60], ['CI', 3, 30]]);
  assert.equal(json.countryBreakdown[0].country, 'Sénégal');
  assert.deepEqual(json.unknownCountry, { users: 1, pct: 10 });
});

test('overview : sans compteurs anonymes, repli sur les pays des sessions', async () => {
  const handler = loadWith({ user_sessions: { a: { country: 'Mali', countryCode: 'ML', lastLoginAt: Date.now() }, b: { lastLoginAt: Date.now() } } });
  const { json } = await call(handler, { action: 'overview' });
  assert.equal(json.countryPeriod, null);
  assert.deepEqual(json.countryBreakdown.map((c) => c.countryCode), ['ML']);
  assert.equal(json.unknownCountry.users, 1);
});

test('analytics : les compteurs anonymes alimentent visites, uniques et appareils', async () => {
  const handler = loadWith({ analytics: { daily: {
    [day(0)]: { visits: 10, unique: 7, platforms: { android_app: 5, desktop: 2 } },
    [day(2)]: { visits: 4, unique: 3, platforms: { ios: 3 } }
  } } });
  const { json } = await call(handler, { action: 'analytics' });
  assert.equal(json.periods.d7.total, 14);
  assert.equal(json.periods.d7.unique, 7);
  assert.equal(json.daily.at(-1).total, 10);
  assert.deepEqual(json.platforms, { android_app: 5, android_web: 0, ios: 3, desktop: 2, inconnu: 0 });
});

test('activity : connexions (e-mail, pays, heure) et actions, filtrables par e-mail', async () => {
  const now = Date.now();
  const handler = loadWith({
    user_sessions: {
      a: { email: 'a@x.test', country: 'Sénégal', countryCode: 'SN', platform: 'ios', lastLoginAt: now - 5000, lastActivityAt: now - 1000, lastAction: 'Ouvrir' },
      b: { email: 'b@x.test', lastLoginAt: now - 90000 },
      junk: 'x'
    },
    activity_feed: {
      k1: { email: 'a@x.test', type: 'click', page: 'marche', label: 'Ouvrir', countryCode: 'SN', country: 'Sénégal', at: now - 1000 },
      k2: { email: 'b@x.test', type: 'visit', page: 'accueil', at: now - 90000 },
      k3: { email: 'A@x.test', type: 'page', page: 'zikr', at: now - 3000 }
    }
  });
  const all = (await call(handler, { action: 'activity' })).json;
  assert.deepEqual(all.sessions.map((s) => [s.email, s.countryCode, s.lastAction]), [['a@x.test', 'SN', 'Ouvrir'], ['b@x.test', '', '']]);
  assert.equal(all.sessions[0].loginAt, now - 5000);
  assert.deepEqual(all.actions.map((a) => a.page), ['marche', 'zikr', 'accueil']);
  const one = (await call(handler, { action: 'activity', email: 'a@x.test' })).json;
  assert.deepEqual(one.actions.map((a) => a.type), ['click', 'page']);
});

test('reset_stats : refusé sans « SUPPRIMER », puis efface uniquement les statistiques', async () => {
  const data = {
    analytics: { daily: { x: 1 }, visits: { y: 1 }, ads: {}, csp: {} },
    activity_feed: { k: { email: 'a@x.test' } },
    user_sessions: { a: { email: 'a@x.test' } },
    views: { product: { p1: { u: 1 } } },
    purchased_user: { 'a@x,test': { level: 15000 } },
    det_produits: { p1: { produit: 'Livre' } },
    ratings: { vendor: { v: { u: 5 } } },
    account_settings: { a: { pushEnabled: true } }
  };
  const handler = loadWith(data);
  const refused = await call(handler, { action: 'reset_stats', confirm: 'oui' });
  assert.equal(refused.status, 400);
  assert.ok(data.analytics && data.activity_feed);
  const { json } = await call(handler, { action: 'reset_stats', confirm: 'SUPPRIMER' });
  assert.equal(json.ok, true);
  assert.deepEqual(Object.keys(data).sort(), ['account_settings', 'admin_meta', 'det_produits', 'purchased_user', 'ratings', 'views']);
  assert.deepEqual(data.views, {});
  assert.ok(data.admin_meta.statsResetAt >= Date.now() - 5000);
});

test('overview : l’activité récente ne montre rien d’antérieur à la remise à zéro', async () => {
  const now = Date.now();
  const handler = loadWith({
    admin_meta: { statsResetAt: now - 60000 },
    purchased_user: { 'old@x,test': { productId: 'admin_grant', at: now - 3600000, expiresAt: now + 1e9 }, 'new@x,test': { productId: 'admin_grant', at: now - 1000, expiresAt: now + 1e9 } },
    user_sessions: { a: { email: 'a@x.test', lastLoginAt: now - 500 } }
  });
  const { json } = await call(handler, { action: 'overview' });
  assert.deepEqual(json.recent.map((e) => e.email), ['a@x.test', 'new@x.test']);
  assert.equal(json.kpis.activeSubs, 2); // les chiffres réels restent complets
});

test('analytics : boutiques calculées comme le Marché de l’application (vendorKey e-mail, j’aime, avis)', async () => {
  // Empreinte de lib/market.js (asrar-main) : v_ + FNV-1a de l’e-mail en minuscules.
  const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); };
  const vk = 'v_' + fnv('vendeur@x.test');
  const handler = loadWith({
    profile_clients: { shop1: { profile_name: 'Asrar Pro boutique', email: 'Vendeur@X.test', uid: 'nouvel-uid', number: '+221' } },
    det_produits: {
      p1: { produit: 'A', email: 'vendeur@x.test', uid: 'ancien-uid' },
      p2: { produit: 'B', email: 'VENDEUR@x.test', uid: 'nouvel-uid' },
      p3: { produit: 'C', email: 'autre@x.test', uid: 'nouvel-uid' }
    },
    views: { product: { p1: { u1: 1, u2: 1 }, p2: { u1: 1 } } },
    ratings: { vendor: { [vk]: { u1: true, u2: true, u3: true }, shop1: { u9: 5 } } },
    comments: { vendor: { [vk]: { c1: { stars: 5 }, c2: { stars: 4 }, c3: { text: 'sans note' } } } }
  });
  const { json } = await call(handler, { action: 'analytics' });
  assert.equal(json.boutiques.length, 1);
  const b = json.boutiques[0];
  assert.equal(b.vendorKey, vk);
  assert.equal(b.products, 2);       // par e-mail, quel que soit l’uid ; « autre@ » exclu
  assert.equal(b.likes, 3);          // ratings/vendor = j’aime
  assert.equal(b.ratingsCount, 2);   // avis = commentaires avec étoiles
  assert.equal(b.rating, 4.5);
  assert.equal(b.views, 3);
  assert.equal(json.totals.avisTotal, 2);
});
