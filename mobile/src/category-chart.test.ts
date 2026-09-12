import assert from 'node:assert/strict';
import test from 'node:test';
import { categoryArcs, categoryAtAngle } from './category-chart.ts';

test('category arcs preserve proportions and map touches back to a category', () => {
  const arcs = categoryArcs([
    { name: 'Housing', spent: 60 },
    { name: 'Dining', spent: 30 },
    { name: 'Ignored refund', spent: -10 },
    { name: 'Travel', spent: 10 },
  ]);

  assert.deepEqual(
    arcs.map(({ name, share, startAngle, endAngle }) => ({
      name,
      share,
      startAngle,
      endAngle,
    })),
    [
      { name: 'Housing', share: 0.6, startAngle: 0, endAngle: 216 },
      { name: 'Dining', share: 0.3, startAngle: 216, endAngle: 324 },
      { name: 'Travel', share: 0.1, startAngle: 324, endAngle: 360 },
    ],
  );
  assert.equal(categoryAtAngle(arcs, 90)?.name, 'Housing');
  assert.equal(categoryAtAngle(arcs, 250)?.name, 'Dining');
  assert.equal(categoryAtAngle(arcs, -10)?.name, 'Travel');
});
