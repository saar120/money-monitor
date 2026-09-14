import assert from 'node:assert/strict';
import test from 'node:test';
import { rootTabFromPath, rootTabHref } from './navigation-state.ts';

test('root tab persistence follows tab drill-down routes', () => {
  assert.equal(rootTabFromPath('/home'), 'home');
  assert.equal(rootTabFromPath('/explore'), 'explore');
  assert.equal(rootTabFromPath('/explore/category/Dining'), 'explore');
  assert.equal(rootTabFromPath('/activity/transaction-42'), 'activity');
  assert.equal(rootTabFromPath('/transaction/42'), null);
});

test('saved tabs resolve to valid root routes', () => {
  assert.equal(rootTabHref('activity'), '/(tabs)/activity');
  assert.equal(rootTabHref('anything-else'), '/(tabs)/home');
});
