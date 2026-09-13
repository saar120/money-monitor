import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cashFlowSummary,
  formatSpendingChange,
  monthlyCategoryNames,
  overviewCashFlow,
  spendingTotal,
} from './money.ts';

test('cash flow reconciles Mac-provided posted income and spending', () => {
  assert.equal(overviewCashFlow(32_512.84, 18_920), 13_592.84);
});

test('cash flow summarizes the full selected time span', () => {
  assert.deepEqual(
    cashFlowSummary([
      { income: 12_000, spending: 8_000 },
      { income: 10_000, spending: 9_000 },
      { income: 14_000, spending: 8_000 },
    ]),
    {
      average: 3_666.67,
      income: 36_000,
      spending: 25_000,
      total: 11_000,
    },
  );
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

test('monthly chart categories stay stable when a different month is selected', () => {
  const months = [
    {
      categories: [
        { name: 'Dining', spent: 400 },
        { name: 'Housing', spent: 900 },
      ],
    },
    {
      categories: [
        { name: 'Groceries', spent: 700 },
        { name: 'Dining', spent: 300 },
      ],
    },
  ];

  assert.deepEqual(monthlyCategoryNames(months), ['Housing', 'Dining', 'Groceries']);
  assert.deepEqual(monthlyCategoryNames([...months].reverse()), ['Housing', 'Dining', 'Groceries']);
});
