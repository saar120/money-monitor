import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const merge = require('deepmerge');
const query = require('query-string');

test('patched deepmerge does not poison merged prototypes from either input', () => {
  const payload = JSON.parse(
    '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"safe":1}',
  );
  for (const result of [
    merge(payload, {}),
    merge({}, payload),
    merge(Object.create(null), payload),
  ]) {
    assert.equal(result.polluted, undefined);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(result.safe, 1);
    assert.equal(Object.hasOwn(result, '__proto__'), false);
    assert.equal(Object.hasOwn(result, 'constructor'), false);
  }
});
test('patched decoder preserves Expo Router query parsing', () => {
  const parsed = query.parse('q=%D7%A9%D7%9C%D7%95%D7%9D&tag=a&tag=b&bad=%E0%A4%A');
  assert.equal(parsed.q, 'שלום');
  assert.deepEqual(parsed.tag, ['a', 'b']);
  assert.equal(typeof parsed.bad, 'string');
});
