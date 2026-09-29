import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistoryCache } from './history-cache.ts';

test('navigation reuses one pending history request and can read its result synchronously', async () => {
  let resolve!: (data: number[]) => void;
  let calls = 0;
  const cache = createHistoryCache<number>(() => {
    calls++;
    return new Promise((done) => {
      resolve = done;
    });
  });
  const parent = cache.load();
  const destination = cache.load();
  assert.equal(parent, destination);
  assert.equal(cache.peek(), undefined);
  await Promise.resolve();
  assert.equal(calls, 1);
  const data = [100, 6100];
  resolve(data);
  await parent;
  assert.equal(cache.peek(), data, 'the destination has data before its first effect');
  assert.equal(await cache.load(), data);
  assert.equal(calls, 1);
});

test('failed history requests can retry and refreshed caches do not expose old data', async () => {
  let calls = 0;
  const fetch = async (count: number) => {
    if (++calls === 1) throw new Error('offline');
    return [count];
  };
  const old = createHistoryCache(fetch);
  await assert.rejects(old.load(), /offline/);
  assert.equal(old.peek(), undefined);
  assert.deepEqual(await old.load(), [12]);
  const refreshed = createHistoryCache(fetch);
  assert.equal(refreshed.peek(), undefined);
  assert.deepEqual(await refreshed.load(6), [6]);
  assert.equal(refreshed.peek(12), undefined);
});

test('the actual history hook renders cached data before any mount effect runs', async () => {
  const { readFileSync } = await import('node:fs');
  const { runInNewContext } = await import('node:vm');
  const { default: ts } = await import('typescript');
  const data = [{ month: '2026-09' }];
  const cache = createHistoryCache(async () => data);
  await cache.load();
  const source = readFileSync(new URL('./MoneyData.tsx', import.meta.url), 'utf8');
  const hook = source.slice(
    source.indexOf('export function useExploreHistory('),
    source.indexOf('export function useActivityTransactions('),
  );
  const module = {
    exports: {} as { useExploreHistory: () => { months: unknown[]; loading: boolean } },
  };
  runInNewContext(
    ts.transpileModule(hook, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    {
      module,
      exports: module.exports,
      useMoneyData: () => ({ status: 'ready', exploreHistory: cache }),
      useState: (initial: unknown) => [
        typeof initial === 'function' ? initial() : initial,
        () => {},
      ],
      useEffect: () => {},
    },
  );
  const firstFrame = module.exports.useExploreHistory();
  assert.equal(firstFrame.months, data);
  assert.equal(firstFrame.loading, false);
});
