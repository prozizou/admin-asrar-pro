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
