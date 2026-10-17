const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

test('rebuild uses the locked node-gyp without a Windows command shell', () => {
  const calls = [];
  const mockRequire = (name) =>
    name === 'child_process' ? { execFileSync: (...args) => calls.push(args) } : require(name);
  mockRequire.resolve = require.resolve;
  runInNewContext(readFileSync(join(__dirname, 'electron-rebuild.cjs'), 'utf8'), {
    require: mockRequire,
    __dirname: join(__dirname, 'checkout with spaces & symbols'),
    process: { platform: 'win32', execPath: process.execPath, env: {} },
    console: { log() {} },
  });

  assert.equal(calls.length, 1);
  const [command, args, options] = calls[0];
  assert.equal(command, process.execPath);
  assert.equal(args[0], require.resolve('node-gyp/bin/node-gyp.js'));
  assert.equal(args[1], 'rebuild');
  assert.ok(args.includes(`--target=${require('electron/package.json').version}`));
  assert.ok(args.includes('--dist-url=https://electronjs.org/headers'));
  assert.ok(!options.shell);
});
