import assert from 'node:assert/strict';
import test from 'node:test';
import { overviewCashFlow } from './money.ts';

test('cash flow reconciles Mac-provided posted income and spending', () => {
  assert.equal(overviewCashFlow(32_512.84, 18_920), 13_592.84);
});
