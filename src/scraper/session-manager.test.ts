import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertAccount } from '../__tests__/helpers/fixtures.js';

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
