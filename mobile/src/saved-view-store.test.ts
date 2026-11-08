import assert from 'node:assert/strict';
import test from 'node:test';
import { createSavedViewStore } from './saved-view-store.ts';
import { fixtureScenarios } from './fixtures.ts';

test('Saved View survives restart, binds pairing, and enforces stale/delete/clock boundaries', async () => {
  let persisted: string | null = null;
  const storage = {
    read: async () => persisted,
    write: async (v: string) => {
      persisted = v;
    },
    remove: async () => {
      persisted = null;
    },
    encrypt: async (v: string) => v,
    decrypt: async (v: string) => v,
  };
  const start = Date.parse('2026-11-08T00:00:00Z');
  const home = {
    ...fixtureScenarios.normal,
    snapshot: {
      id: 'test-snapshot',
      calculatedAt: new Date(start).toISOString(),
      staleAt: new Date(start + 86400000).toISOString(),
      deleteAfter: new Date(start + 7 * 86400000).toISOString(),
      complete: true,
      cacheable: true,
    },
  };
  const save = () => createSavedViewStore(storage).save('pair-a', home, start);
  await save();
  assert.equal((await createSavedViewStore(storage).load('pair-a', start))?.status, 'saved-view');
  assert.equal(
    (await createSavedViewStore(storage).load('pair-a', start + 86400000))?.status,
    'stale-saved-view',
  );
  assert.equal(await createSavedViewStore(storage).load('pair-a', start + 7 * 86400000), null);
  await save();
  assert.equal(await createSavedViewStore(storage).load('pair-b', start), null);
  await save();
  await createSavedViewStore(storage).load('pair-a', start + 10000);
  assert.equal(await createSavedViewStore(storage).load('pair-a', start + 9999), null);
  persisted = '{broken';
  assert.equal(await createSavedViewStore(storage).load('pair-a', start), null);
  await save();
  const retained = persisted;
  await createSavedViewStore(storage).save(
    'pair-a',
    { ...home, snapshot: { ...home.snapshot, complete: false } },
    start,
  );
  assert.equal(
    persisted,
    retained,
    'partial live data cannot replace the accepted complete snapshot',
  );
  const malformed = JSON.parse(persisted!);
  malformed.home.categories = [null];
  persisted = JSON.stringify(malformed);
  assert.equal(await createSavedViewStore(storage).load('pair-a', start), null);
});
