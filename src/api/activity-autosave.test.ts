import { it, expect } from 'vitest';
import { createActivityAutosave } from '../../dashboard/src/components/activity-autosave.js';
import type { Transaction, TransactionCommand } from '../../dashboard/src/api/client.js';
it('serializes each transaction, preserves newer intent, and replays unknown commands before it', async () => {
  const row = { id: 1, resourceVersion: 1, category: 'food' } as Transaction;
  const calls: TransactionCommand[] = [];
  const pending: Array<{
    resolve: (value: { transaction: Transaction }) => void;
    reject: (cause: Error) => void;
  }> = [];
  let id = 0;
  const saves = createActivityAutosave({
    newId: () => String(++id),
    changed: () => {},
    accepted: () => {},
    classify: () => ({ kind: 'unknown' }),
    submit: (_, command) => {
      calls.push(command);
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
  });
  const first = saves.edit(row, { category: 'travel' });
  await Promise.resolve();
  saves.edit(row, { category: 'food' });
  expect(calls).toHaveLength(1);
  pending[0].reject(new Error('response lost'));
  await first;
  expect(saves.draft(1)).toEqual({ category: 'food' });
  const retry = saves.retry(1);
  await Promise.resolve();
  expect(calls[1]).toEqual(calls[0]);
  pending[1].resolve({ transaction: { ...row, resourceVersion: 2, category: 'travel' } });
  await Promise.resolve();
  await Promise.resolve();
  expect(calls[2]).toMatchObject({ expectedVersion: 2, patch: { category: 'food' } });
  pending[2].resolve({ transaction: { ...row, resourceVersion: 3 } });
  await retry;
  expect(saves.entries()[0].accepted.resourceVersion).toBe(3);
  expect(saves.draft(1)).toEqual({});
});
