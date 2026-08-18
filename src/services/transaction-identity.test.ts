import { describe, expect, it } from 'vitest';
import { claimOneZeroSourceTarget, oneZeroDateFieldsOverlap } from './transaction-identity.js';

describe('One Zero date matching', () => {
  it.each([
    [
      { movementDate: '2026-07-02', valueDate: '2026-07-01' },
      { date: '2026-07-01', processedDate: '2026-07-03' },
    ],
    [
      { movementDate: '2026-06-05', valueDate: '2026-06-07' },
      { date: '2026-06-07', processedDate: '2026-06-05' },
    ],
    [
      { movementDate: '2026-06-03', valueDate: '2026-06-01' },
      { date: '2026-06-01', processedDate: '2026-06-04' },
    ],
  ])('matches an exact date field even when the pair differs', (source, existing) => {
    expect(oneZeroDateFieldsOverlap(source, existing)).toBe(true);
  });

  it('does not turn an exact cents/date match into a match when two candidates exist', () => {
    const source = { movementDate: '2026-06-03', valueDate: '2026-06-01' };
    const candidates = [
      { date: '2026-06-01', processedDate: '2026-06-04' },
      { date: '2026-06-03', processedDate: '2026-06-05' },
    ];
    const matches = candidates.filter((candidate) => oneZeroDateFieldsOverlap(source, candidate));

    expect(matches).toHaveLength(2);
  });

  it('does not allow a one-day-only date difference', () => {
    expect(
      oneZeroDateFieldsOverlap(
        { movementDate: '2026-06-03', valueDate: '2026-06-01' },
        { date: '2026-06-04', processedDate: '2026-06-05' },
      ),
    ).toBe(false);
  });

  it('claims an existing source target so a second legitimate reference cannot reuse it', () => {
    const claimed = new Set<number>();
    expect(claimOneZeroSourceTarget(42, claimed)).toBe(true);

    // This models the fallback candidate filter in analyzeImport: the target
    // already represented by the duplicate source row is no longer available.
    const fallbackCandidates = [42].filter((id) => !claimed.has(id));
    expect(fallbackCandidates).toEqual([]);
    expect(claimOneZeroSourceTarget(undefined, claimed)).toBe(false);
  });
});
