import type { Transaction } from './fixtures';
export type ReviewViewState = 'loading' | 'error' | 'complete' | 'transaction';

export function getReviewViewState({
  loading,
  saving,
  hasCurrent,
  hasError,
  remaining,
}: {
  loading: boolean;
  saving: boolean;
  hasCurrent: boolean;
  hasError: boolean;
  remaining: number;
}): ReviewViewState {
  if (!hasCurrent && (loading || saving || (!hasError && remaining > 0))) return 'loading';
  if (!hasCurrent && hasError && remaining > 0) return 'error';
  if (!hasCurrent) return 'complete';
  return 'transaction';
}

// The picked category is the only signal of a change: a card held after a failed save already shows it.
// The Mac sets inclusion from a new category, so an exclusion shown on the card goes with it.
export function reviewConfirmation(
  category?: string,
  included?: boolean,
): { category?: string; included?: boolean; reviewed: true } {
  if (!category) return { reviewed: true };
  return included === undefined
    ? { category, reviewed: true }
    : { category, included, reviewed: true };
}

export type ReviewDraft = Partial<Pick<Transaction, 'category' | 'included' | 'owner'>>;
type QueueState = { queue: Transaction[]; laterIds: string[]; reviewedIds: string[] };
export type ReviewSession = QueueState &
  (
    | { phase: 'loading' | 'complete'; card: null; draft: ReviewDraft; error: null }
    | {
        phase: 'presenting' | 'recoverable-error';
        card: Transaction;
        draft: ReviewDraft;
        error: string | null;
      }
    | { phase: 'saving'; card: Transaction; draft: ReviewDraft; error: null; actionId: number }
    | {
        phase: 'departing';
        card: Transaction;
        draft: ReviewDraft;
        error: null;
        actionId: number;
        departure: 'accepted' | 'later';
      }
  );
export function createReviewSession(): ReviewSession {
  return {
    phase: 'loading',
    card: null,
    draft: {},
    error: null,
    queue: [],
    laterIds: [],
    reviewedIds: [],
  };
}
export function reviewQueue(state: QueueState) {
  const remaining = state.queue.filter((row) => !state.reviewedIds.includes(row.id));
  return [
    ...remaining.filter((row) => !state.laterIds.includes(row.id)),
    ...state.laterIds.flatMap((id) => remaining.find((row) => row.id === id) ?? []),
  ];
}
function nextCard(state: QueueState): ReviewSession {
  const card = reviewQueue(state)[0];
  return card
    ? { ...state, phase: 'presenting', card, draft: {}, error: null }
    : { ...state, phase: 'complete', card: null, draft: {}, error: null };
}
type Event =
  | { type: 'sync'; transactions: Transaction[] }
  | { type: 'draft'; cardId: string; patch: ReviewDraft }
  | { type: 'save'; cardId: string; actionId: number; patch?: ReviewDraft }
  | { type: 'field-accepted'; actionId: number; transaction: Transaction; patch: ReviewDraft }
  | { type: 'accepted'; actionId: number; transaction: Transaction }
  | {
      type: 'failed';
      actionId: number;
      message: string;
      rejectedPatch?: ReviewDraft;
      current?: Transaction;
    }
  | { type: 'later'; cardId: string; actionId: number }
  | { type: 'motion-finished'; actionId: number };
export function reviewSessionReducer(state: ReviewSession, event: Event): ReviewSession {
  if (event.type === 'sync') {
    const updated = { ...state, queue: event.transactions };
    if (
      state.phase === 'saving' ||
      state.phase === 'departing' ||
      state.phase === 'recoverable-error'
    )
      return updated;
    const card = state.card && event.transactions.find((row) => row.id === state.card!.id);
    return card
      ? { ...updated, phase: 'presenting', card, draft: state.draft, error: null }
      : nextCard(updated);
  }
  if (event.type === 'draft')
    return state.card?.id === event.cardId &&
      (state.phase === 'presenting' || state.phase === 'recoverable-error')
      ? { ...state, draft: { ...state.draft, ...event.patch } }
      : state;
  if (event.type === 'save' || event.type === 'later') {
    if (
      !state.card ||
      state.card.id !== event.cardId ||
      !['presenting', 'recoverable-error'].includes(state.phase)
    )
      return state;
    return event.type === 'later'
      ? {
          ...state,
          phase: 'departing',
          card: state.card,
          actionId: event.actionId,
          departure: 'later',
          error: null,
        }
      : {
          ...state,
          phase: 'saving',
          card: state.card,
          actionId: event.actionId,
          draft: { ...state.draft, ...event.patch },
          error: null,
        };
  }
  if (!('actionId' in state) || state.actionId !== event.actionId) return state;
  if (event.type === 'failed' && state.phase === 'saving') {
    const draft = { ...state.draft };
    if (event.rejectedPatch)
      for (const key of Object.keys(event.rejectedPatch) as Array<keyof ReviewDraft>)
        delete draft[key];
    return {
      ...state,
      phase: 'recoverable-error',
      card: event.current ?? state.card,
      draft,
      error: event.message,
    };
  }
  if (event.type === 'field-accepted' && state.phase === 'saving') {
    const draft = { ...state.draft };
    for (const key of Object.keys(event.patch) as Array<keyof ReviewDraft>) delete draft[key];
    return { ...state, phase: 'presenting', card: event.transaction, draft, error: null };
  }
  if (event.type === 'accepted' && state.phase === 'saving')
    return {
      ...state,
      phase: 'departing',
      card: event.transaction,
      draft: {},
      departure: 'accepted',
      error: null,
    };
  if (event.type === 'motion-finished' && state.phase === 'departing')
    return nextCard({
      ...state,
      reviewedIds:
        state.departure === 'accepted'
          ? [...new Set([...state.reviewedIds, state.card.id])]
          : state.reviewedIds,
      laterIds:
        state.departure === 'later'
          ? [...state.laterIds.filter((id) => id !== state.card.id), state.card.id]
          : state.laterIds,
    });
  return state;
}
