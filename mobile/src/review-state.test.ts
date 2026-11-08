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

test('review persistence and card motion advance once while Later remains unreviewed', async () => {
  const { createReviewSession, reviewSessionReducer } = await import('./review-state.ts');
  const { fixtureScenarios } = await import('./fixtures.ts');
  const card = fixtureScenarios.normal.transactions[0];
  let state = reviewSessionReducer(createReviewSession(), { type: 'sync', transactions: [card] });
  state = reviewSessionReducer(state, {
    type: 'draft',
    cardId: card.id,
    patch: { category: 'Travel' },
  });
  state = reviewSessionReducer(state, { type: 'save', cardId: card.id, actionId: 1 });
  state = reviewSessionReducer(state, {
    type: 'failed',
    actionId: 1,
    message: 'Synthetic failure',
  });
  assert.equal(state.card?.id, card.id);
  assert.equal(state.draft.category, 'Travel');
  state = reviewSessionReducer(state, { type: 'later', cardId: card.id, actionId: 2 });
  state = reviewSessionReducer(state, { type: 'motion-finished', actionId: 2 });
  assert.equal(state.reviewedIds.length, 0);
  assert.equal(state.card?.id, card.id);
  state = reviewSessionReducer(state, { type: 'save', cardId: card.id, actionId: 3 });
  state = reviewSessionReducer(state, {
    type: 'accepted',
    actionId: 3,
    transaction: { ...card, needsReview: false },
  });
  assert.equal(state.phase, 'departing');
  state = reviewSessionReducer(state, { type: 'motion-finished', actionId: 3 });
  assert.equal(state.phase, 'complete');
  assert.deepEqual(state.reviewedIds, [card.id]);
  assert.equal(reviewSessionReducer(state, { type: 'motion-finished', actionId: 3 }), state);
});
