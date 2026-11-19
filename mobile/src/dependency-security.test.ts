import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const query = require('query-string');

test('patched decoder preserves Expo Router query parsing', () => {
  const parsed = query.parse('q=%D7%A9%D7%9C%D7%95%D7%9D&tag=a&tag=b&bad=%E0%A4%A');
  assert.equal(parsed.q, 'שלום');
  assert.deepEqual(parsed.tag, ['a', 'b']);
  assert.equal(typeof parsed.bad, 'string');
});
