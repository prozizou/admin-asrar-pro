const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const key = '20261122_' + 'a'.repeat(32);
function load({ denied = 0, entries = {} } = {}) {
  const reads = [], writes = [], audits = [];
  let initialized = false;
  const db = { ref: p => {
    const query = { p };
    const ref = {
      orderByKey() { query.order = 'key'; return ref; },
      startAt(value) { query.start = value; return ref; },
      limitToLast(value) { query.limit = value; return ref; },
      async once() { reads.push(query); return { val: () => entries }; },
      async transaction(fn) {
        const id = p.split('/').at(-1), next = fn(entries[id]);
        if (next === undefined) return { committed: false };
        entries[id] = next; writes.push({ p, next }); return { committed: true };
      }
    }; return ref;
  } };
  const fb = require.resolve('../api/_lib/fb');
  require.cache[fb] = { id: fb, filename: fb, loaded: true, exports: {
    app: () => { initialized = true; return { database: () => db }; },
    bearer: req => req.headers.authorization,
    verifyAdmin: async token => {
      if (denied || !token) throw Object.assign(Error('Refusé'), { statusCode: denied || 401 });
      return { uid: 'admin', email: 'admin@example.invalid' };
    }, audit: async (...args) => audits.push(args),
  } };
  const modulePath = require.resolve('../api/diagnostics'); delete require.cache[modulePath];
  const handler = require(modulePath);
  async function call(body, token = 'token', method = 'POST') {
    const res = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method, headers: { authorization: token }, body }, res); return res;
  }
  return { call, reads, writes, audits, initialized: () => initialized };
}
test('diagnostics : l’authentification et le rôle sont vérifiés avant tout accès aux données', async () => {
  for (const status of [401, 403]) {
    const api = load({ denied: status });
    assert.equal((await api.call({ action: 'list' })).code, status);
    assert.equal((await api.call({ action: 'status', id: key, expectedCount: 1, status: 'resolved' })).code, status);
    assert.equal(api.initialized(), false);
  }
});
test('diagnostics : liste bornée, ordre récent et limite annoncée', async () => {
  const api = load({ entries: { b: { lastAt: 2 }, a: { lastAt: 1 } } });
  const res = await api.call({ action: 'list' });
  assert.equal(res.code, 200); assert.deepEqual(res.body.items.map(v => v.id), ['b', 'a']);
  assert.equal(api.reads[0].limit, 500); assert.equal(api.reads[0].order, 'key');
  assert.match(api.reads[0].start, /^\d{8}$/); assert.equal(res.body.limited, false);
});
test('diagnostics : résolution atomique, audit, et refus d’écraser une nouvelle occurrence', async () => {
  const api = load({ entries: { [key]: { count: 2, status: 'open', lastAt: 2 } } });
  assert.equal((await api.call({ action: 'status', id: key, status: 'resolved', expectedCount: 1 })).code, 409);
  assert.equal(api.writes.length, 0);
  assert.equal((await api.call({ action: 'status', id: key, status: 'resolved', expectedCount: 2 })).code, 200);
  assert.equal(api.writes[0].next.status, 'resolved'); assert.equal(api.writes[0].next.resolvedBy, 'admin');
  assert.equal(api.audits[0][1], 'diagnostic:resolved');
  assert.equal((await api.call({ action: 'status', id: key, status: 'open', expectedCount: 2 })).code, 200);
  assert.equal(api.writes[1].next.resolvedAt, null);
});
test('diagnostics : validation des mutations et méthodes', async () => {
  const api = load();
  assert.equal((await api.call({ action: 'status', id: '../admins/x', status: 'resolved', expectedCount: 1 })).code, 400);
  assert.equal((await api.call({ action: 'status', id: key, status: 'injected', expectedCount: 1 })).code, 400);
  assert.equal((await api.call({ action: 'delete' })).code, 400);
  assert.equal((await api.call({}, 'token', 'GET')).code, 405);
  assert.equal((await api.call('null')).code, 400);
  assert.equal(api.writes.length, 0);
});
