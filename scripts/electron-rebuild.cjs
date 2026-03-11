// Rebuild better-sqlite3 native module for Electron's Node.js version.
// Uses node-gyp directly since @electron/rebuild has reliability issues.
const { execFileSync } = require('child_process');
const { join } = require('path');

const electronPkg = require('electron/package.json');
const target = electronPkg.version;
const cwd = join(__dirname, '..', 'node_modules', 'better-sqlite3');

console.log(`Rebuilding better-sqlite3 for Electron ${target}...`);

execFileSync('npx', [
  'node-gyp', 'rebuild',
  '--runtime=electron',
  `--target=${target}`,
  '--dist-url=https://electronjs.org/headers',
], { cwd, stdio: 'inherit', shell: true });

console.log('Rebuild complete.');
