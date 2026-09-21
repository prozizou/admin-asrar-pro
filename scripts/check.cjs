const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const roots = ['.', 'api', 'api/_lib', 'scripts', 'tests'];
let count = 0;
for (const directory of roots) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && /\.(c?js)$/.test(entry.name)) {
      execFileSync(process.execPath, ['--check', join(directory, entry.name)], { stdio: 'inherit' });
      count++;
    }
  }
}
console.log(`${count} JavaScript files checked.`);
