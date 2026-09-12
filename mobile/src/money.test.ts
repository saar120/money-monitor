import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSpendingChange, overviewCashFlow, spendingTotal } from './money.ts';

test('cash flow reconciles Mac-provided posted income and spending', () => {
  assert.equal(overviewCashFlow(32_512.84, 18_920), 13_592.84);
});

test('spending totals explain whether money was spent or received', () => {
  assert.deepEqual(spendingTotal(1_823.43), {
    amount: '₪1,823',
    label: 'Net spent',
  });
  assert.deepEqual(spendingTotal(-2_480.1), {
    amount: '₪2,480',
    label: 'Net received',
  });
  assert.deepEqual(spendingTotal(0), {
    amount: '₪0',
    label: 'No net spending',
  });
});

test('spending changes use plain language instead of accounting signs', () => {
  assert.equal(formatSpendingChange(89), '₪89 more spent');
  assert.equal(formatSpendingChange(-2_510.67), '₪2,511 less spent');
  assert.equal(formatSpendingChange(0), 'No change');
});
