import assert from 'node:assert/strict';
import test from 'node:test';
import { adjacentMonth, chartIndexAtPosition } from './motion-state.ts';

test('scrubbing clamps outside the plot without inventing a month', () => {
  assert.equal(chartIndexAtPosition(-20, 300, 6), 0);
  assert.equal(chartIndexAtPosition(149, 300, 6), 2);
  assert.equal(chartIndexAtPosition(500, 300, 6), 5);
  assert.equal(chartIndexAtPosition(100, 300, 0), -1);
});

test('month swipes follow reading direction and stop at available history boundaries', () => {
  const months = ['2026-09', '2026-07', '2026-08'];
  assert.equal(adjacentMonth('2026-08', months, 80, false), '2026-07');
  assert.equal(adjacentMonth('2026-08', months, -80, true), '2026-07');
  assert.equal(adjacentMonth('2026-09', months, -80, false), undefined);
  assert.equal(adjacentMonth('2026-07', months, 80, false), undefined);
});
