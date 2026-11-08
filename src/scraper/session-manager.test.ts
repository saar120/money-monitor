import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertAccount } from '../__tests__/helpers/fixtures.js';
import type { ScrapeResult } from './scraper.service.js';

let testDb: TestDb;

vi.mock('../db/connection.js', () => ({
  get db() {
    return testDb.db;
  },
  get sqlite() {
    return testDb.sqlite;
  },
  isDemoMode: () => false,
  closeAll: () => {},
}));

vi.mock('./scraper.service.js', () => ({
  scrapeAccount: vi.fn(),
}));

vi.mock('../api/sse.js', () => ({
  broadcastSseEvent: vi.fn(),
}));

vi.mock('../telegram/alerts.js', () => ({
  runPostScrapeAlerts: vi.fn(),
}));

const { getUniqueActiveAccounts } = await import('./session-manager.js');

describe('getUniqueActiveAccounts', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb?.close();
  });

  it('excludes manual-scrape-only accounts', () => {
    insertAccount(testDb.db, { displayName: 'Regular', manualScrapeOnly: false });
    insertAccount(testDb.db, { displayName: 'Manual Only', manualScrapeOnly: true });

    const result = getUniqueActiveAccounts();
    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe('Regular');
  });

  it('excludes inactive accounts', () => {
    insertAccount(testDb.db, { displayName: 'Active', isActive: true });
    insertAccount(testDb.db, { displayName: 'Inactive', isActive: false });

    const result = getUniqueActiveAccounts();
    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe('Active');
  });

  it('deduplicates by credentialsRef', () => {
    const ref = 'shared-ref';
    insertAccount(testDb.db, { displayName: 'First', credentialsRef: ref });
    insertAccount(testDb.db, { displayName: 'Second', credentialsRef: ref });

    const result = getUniqueActiveAccounts();
    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe('First');
  });

  it('includes manual-scrape-only=false even if sibling is manual-only (shared credentialsRef)', () => {
    const ref = 'shared-ref';
    insertAccount(testDb.db, {
      displayName: 'Manual',
      credentialsRef: ref,
      manualScrapeOnly: true,
    });
    insertAccount(testDb.db, {
      displayName: 'Auto',
      credentialsRef: ref,
      manualScrapeOnly: false,
    });

    const result = getUniqueActiveAccounts();
    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe('Auto');
  });

  it('returns empty array when all accounts are manual-only', () => {
    insertAccount(testDb.db, { manualScrapeOnly: true });
    insertAccount(testDb.db, { manualScrapeOnly: true });

    const result = getUniqueActiveAccounts();
    expect(result).toHaveLength(0);
  });
});

it('keeps cancelled work admitted until the active step drains and forbids overlap', async () => {
  const { runScrapeSession, cancelSession, hasActiveSessions, getActiveSession } =
    await import('./session-manager.js');
  const { scrapeAccount } = await import('./scraper.service.js');
  testDb = createTestDb();
  const account = insertAccount(testDb.db);
  let release!: (value: { results: []; categorizePending: null }) => void;
  vi.mocked(scrapeAccount).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const { session } = runScrapeSession('single', [account]);
  await Promise.resolve();
  const completion = getActiveSession(session.id)!.promise;
  expect(cancelSession(session.id)).toBe(true);
  expect(hasActiveSessions()).toBe(true);
  expect(getActiveSession(session.id)!.session.status).toBe('cancelling');
  expect(() => runScrapeSession('single', [account])).toThrow('already in progress');
  release({ results: [], categorizePending: null });
  await completion;
  expect(hasActiveSessions()).toBe(false);
  expect(
    testDb.sqlite.prepare('SELECT status FROM scrape_sessions WHERE id = ?').get(session.id),
  ).toEqual({ status: 'cancelled' });
});

it.each([false, true])(
  'hands the complete %s mixed session to the existing alert consumer once',
  async (mixed) => {
    const { runScrapeSession, getActiveSession } = await import('./session-manager.js');
    const { scrapeAccount } = await import('./scraper.service.js');
    const { runPostScrapeAlerts } = await import('../telegram/alerts.js');
    vi.mocked(runPostScrapeAlerts).mockClear();
    testDb = createTestDb();
    const failedAccount = insertAccount(testDb.db);
    const failure = {
      success: false,
      accountId: failedAccount.id,
      transactionsFound: 0,
      transactionsNew: 0,
      durationMs: 1,
      errorType: 'INVALID_PASSWORD',
      error: 'Synthetic rejected login',
    };
    vi.mocked(scrapeAccount).mockResolvedValueOnce({ results: [failure], categorizePending: null });
    const accounts = [failedAccount];
    const results: ScrapeResult[] = [failure];
    if (mixed) {
      const successfulAccount = insertAccount(testDb.db);
      accounts.push(successfulAccount);
      const success = {
        success: true,
        accountId: successfulAccount.id,
        transactionsFound: 1,
        transactionsNew: 1,
        durationMs: 1,
      };
      vi.mocked(scrapeAccount).mockResolvedValueOnce({
        results: [success],
        categorizePending: Promise.resolve(),
      });
      results.push(success);
    }
    const { session } = runScrapeSession('manual', accounts);
    await getActiveSession(session.id)!.promise;
    expect(runPostScrapeAlerts).toHaveBeenCalledTimes(1);
    expect(runPostScrapeAlerts).toHaveBeenCalledWith(
      results,
      expect.stringMatching(/^post-import:\d+$/),
    );
  },
);
