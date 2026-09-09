import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureScenarios } from './fixtures.ts';

test('fixture review counts match their financial inboxes', () => {
  for (const scenario of Object.values(fixtureScenarios)) {
    assert.equal(
      scenario.reviewCount,
      scenario.transactions.filter((transaction) => transaction.needsReview).length,
      scenario.name,
    );
  }
});

test('the no-transactions fixture contains no derived spending', () => {
  const scenario = fixtureScenarios['no-transactions'];
  assert.equal(scenario.spent, 0);
  assert.deepEqual(scenario.categories, []);
  assert.deepEqual(scenario.merchants, []);
  assert.ok(scenario.budgets.every((budget) => budget.spent === 0 && budget.usedPercent === 0));
});
