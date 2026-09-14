import assert from 'node:assert/strict';
import test from 'node:test';
import { activityRequestState } from './activity-request-state.ts';

test('a failed activity request stops loading', () => {
  assert.equal(
    activityRequestState({
      source: 'live',
      loading: false,
      resultKey: '',
      requestKey: 'budget-query',
      error: 'The request failed.',
    }),
    'error',
  );
});
