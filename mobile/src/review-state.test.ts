import assert from 'node:assert/strict';
import test from 'node:test';
import { getReviewViewState, reviewConfirmation } from './review-state.ts';

test('keeps a non-empty review queue in loading state until its transactions arrive', () => {
  assert.equal(
    getReviewViewState({
      loading: true,
      saving: false,
      hasCurrent: false,
      hasError: false,
      remaining: 3,
    }),
    'loading',
  );
});

test('does not flash inbox zero between a retry and its response', () => {
  assert.equal(
    getReviewViewState({
      loading: false,
      saving: false,
      hasCurrent: false,
      hasError: false,
      remaining: 3,
    }),
    'loading',
  );
});

test('shows completion only when no review work remains', () => {
  assert.equal(
    getReviewViewState({
      loading: false,
      saving: false,
      hasCurrent: false,
      hasError: false,
      remaining: 0,
    }),
    'complete',
  );
});

test('waits for the final mutation before showing review completion', () => {
  assert.equal(
    getReviewViewState({
      loading: false,
      saving: true,
      hasCurrent: false,
      hasError: false,
      remaining: 0,
    }),
    'loading',
  );
});

test('a retried confirmation still sends the category picked before the failed save', () => {
  assert.deepEqual(reviewConfirmation('Groceries'), { category: 'Groceries', reviewed: true });
  assert.deepEqual(reviewConfirmation(), { reviewed: true });
  assert.deepEqual(reviewConfirmation('Groceries', false), {
    category: 'Groceries',
    included: false,
    reviewed: true,
  });
  assert.deepEqual(reviewConfirmation(undefined, false), { reviewed: true });
});
