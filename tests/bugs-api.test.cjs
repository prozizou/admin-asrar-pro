// API /api/bugs — lit et traite bug_reports/* avec un faux Firebase (aucun accès réseau, aucun secret).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const DAY = 864e5;
const day = (offset) => new Date(Date.now() - offset * DAY).toISOString().slice(0, 10);

function fakeDb(initial) {
  const data = structuredClone(initial);
  const get = (p) => p.split('/').filter(Boolean).reduce((v, k) => (v == null ? v : v[k]), data);
  const set = (p, value) => {
    const keys = p.split('/').filter(Boolean);
    let node = data;
    for (const k of keys.slice(0, -1)) node = node[k] ??= {};
    if (value == null) delete node[keys.at(-1)]; else node[keys.at(-1)] = value;
  };
  const ref = (p, q = {}) => ({
    orderByChild: (c) => ref(p, { ...q, child: c }),
    orderByKey: () => ref(p, q),
    limitToLast: (n) => ref(p, { ...q, last: n }),
    startAt: (v) => ref(p, { ...q, start: v }),
    equalTo: (v) => ref(p, { ...q, equal: v }),
    once: async () => {
      let entries = Object.entries(get(p) || {});
      if ('start' in q) entries = entries.filter(([k]) => k >= q.start);
      if ('equal' in q) entries = entries.filter(([, v]) => v && v[q.child] === q.equal);
      if (q.last) entries = entries.slice(-q.last);
      const value = typeof get(p) === 'object' && get(p) !== null && !Array.isArray(get(p)) ? Object.fromEntries(entries) : get(p);
      return { val: () => (value && Object.keys(value).length ? structuredClone(value) : (typeof get(p) === 'object' ? null : get(p) ?? null)) };
    },
    update: async (values) => { for (const [k, v] of Object.entries(values)) set(p + '/' + k, v); },
  });
  return { ref, data };
}

function load(initial) {
  const db = fakeDb(initial);
  const audits = [];
  const fbPath = require.resolve(path.join(__dirname, '..', 'api', '_lib', 'fb.js'));
  require.cache[fbPath] = { id: fbPath, filename: fbPath, loaded: true, exports: {
    app: () => ({ database: () => db }),
    verifyAdmin: async () => ({ email: 'admin@example.test' }),
    bearer: () => 'token',
    audit: async (...a) => { audits.push(a.slice(1)); },
  } };
  const p = require.resolve(path.join(__dirname, '..', 'api', 'bugs.js'));
  delete require.cache[p];
  return { handler: require(p), db, audits };
}

async function call(handler, body) {
  let status = 0, json = null;
  const res = { status(code) { status = code; return this; }, json(value) { json = value; return this; } };
  await handler({ method: 'POST', body, headers: {} }, res);
  return { status, json };
}

const now = Date.now();
const sample = () => ({
  bug_reports: {
    groups: {
      e_a: { kind: 'error', message: 'boom', page: '/zikr', lastPage: '/zikr', count: 5, firstAt: now - 3 * DAY, lastAt: now - 1000, status: 'open', regressed: true, platforms: { android_app: 5 }, stack: 'Error: boom' },
      l_b: { kind: 'lag', message: 'Interface figée', label: 'Interface figée', page: '/planete', count: 2, firstAt: now - DAY, lastAt: now - 5000, status: 'open', sumMs: 7000, maxMs: 4000 },
      e_c: { kind: 'error', message: 'vieux', page: '/', count: 1, firstAt: now - 9 * DAY, lastAt: now - 9 * DAY, status: 'resolved', resolvedAt: now - 8 * DAY },
    },
    events: { e_a: { k1: { at: now - 5000, page: '/zikr', platform: 'android_app' }, k2: { at: now - 1000, page: '/zikr', platform: 'android_app', email: 'a@example.test' } }, e_c: { k3: { at: now - 9 * DAY } } },
    daily: { [day(0)]: { _n: 4, error: 3, user: 1 }, [day(3)]: { _n: 2, lag: 2 }, [day(40)]: { _n: 99, error: 99 } },
  },
});

test('list : bugs triés par dernière apparition, totaux et 30 jours', async () => {
  const { handler } = load(sample());
  const { status, json } = await call(handler, { action: 'list' });
  assert.equal(status, 200);
  assert.deepEqual(json.groups.map((g) => g.id), ['e_a', 'l_b', 'e_c']);
  assert.equal(json.groups[1].avgMs, 3500);
  assert.equal(json.daily.length, 30);
  assert.deepEqual(json.daily.at(-1), { bucket: day(0), error: 3, lag: 0, user: 1 });
  assert.deepEqual(json.totals, { open: 2, openErrors: 1, regressed: 1, errors7: 3, lags7: 2, reports7: 1 });
});

test('events : détail et occurrences récentes d’abord ; identifiant contrôlé', async () => {
  const { handler } = load(sample());
  const { json } = await call(handler, { action: 'events', id: 'e_a' });
  assert.equal(json.group.stack, 'Error: boom');
  assert.deepEqual(json.events.map((e) => e.id), ['k2', 'k1']);
  assert.equal((await call(handler, { action: 'events', id: '../admins' })).status, 400);
  assert.equal((await call(handler, { action: 'events', id: 'e_absent' })).status, 404);
});

test('resolve / reopen / delete / purge_resolved, avec audit', async () => {
  const { handler, db, audits } = load(sample());
  await call(handler, { action: 'resolve', id: 'e_a' });
  assert.equal(db.data.bug_reports.groups.e_a.status, 'resolved');
  assert.equal(db.data.bug_reports.groups.e_a.regressed, undefined);
  await call(handler, { action: 'reopen', id: 'e_a' });
  assert.equal(db.data.bug_reports.groups.e_a.status, 'open');
  await call(handler, { action: 'delete', id: 'l_b' });
  assert.equal(db.data.bug_reports.groups.l_b, undefined);
  const { json } = await call(handler, { action: 'purge_resolved' });
  assert.equal(json.removed, 1);
  assert.equal(db.data.bug_reports.groups.e_c, undefined);
  assert.equal(db.data.bug_reports.events.e_c, undefined);
  assert.deepEqual(audits.map((a) => a[0]), ['bug_resolve', 'bug_reopen', 'bug_delete', 'bug_purge_resolved']);
  assert.equal((await call(handler, { action: 'inconnue', id: 'e_a' })).status, 400);
});
