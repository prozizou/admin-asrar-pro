const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
test('le TXT contient les détails reçus et explique les anciennes remontées', () => {
  const context = { window: {}, Date }; vm.createContext(context);
  vm.runInContext(fs.readFileSync('admin-diagnostic-export.js', 'utf8'), context);
  const text = context.window.diagnosticsText([{ details: { task: 'export-word', timings: { total: 1234 } } }, {}], false);
  assert.match(text, /export-word/); assert.match(text, /1234/);
  assert.match(text, /Non collecté par cette ancienne version/);
});

test('le JSON est structuré, conserve les détails et ne reprend pas de champs arbitraires', () => {
  const context = { window: {}, Date }; vm.createContext(context);
  vm.runInContext(fs.readFileSync('admin-diagnostic-export.js', 'utf8'), context);
  const input = { id: 'incident', kind: 'slow_api', count: 2, maxDurationMs: 1234, details: { phase: 'complete', timings: { total: 1234 }, breadcrumbs: [{ at: 25, type: 'api-start' }] }, idToken: 'SECRET' };
  const parsed = JSON.parse(context.window.diagnosticsJson([input, {}], true));
  assert.equal(parsed.schemaVersion, 1); assert.equal(parsed.lagThresholdMs, 1000);
  assert.equal(parsed.groupCount, 2); assert.equal(parsed.limited, true);
  assert.deepEqual(parsed.incidents[0].details, input.details);
  assert.equal(parsed.incidents[1].details, null);
  assert.equal(parsed.incidents[0].count, 2);
  assert.doesNotMatch(JSON.stringify(parsed), /SECRET|idToken/);
  assert.equal(JSON.parse(context.window.diagnosticsJson([], false)).incidents.length, 0);
});
