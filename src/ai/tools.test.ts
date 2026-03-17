import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertAccount, insertTransaction } from '../__tests__/helpers/fixtures.js';
import * as schema from '../db/schema.js';

// Mock the db connection so tools.ts uses our test DB
let testDb: TestDb;

vi.mock('../db/connection.js', () => ({
  get db() {
    return testDb.db;
  },
}));

// Mock memory module (tools.ts imports from it)
vi.mock('./memory.js', () => ({
  appendMemory: vi.fn(),
  readMemory: vi.fn(() => ''),
  writeMemory: vi.fn(),
}));

// Import after mocking so the module picks up our mock
const { getLatestScrapeTransactions } = await import('./tools.js');

function insertSession(overrides: Partial<typeof schema.scrapeSessions.$inferInsert> = {}) {
  return testDb.db
    .insert(schema.scrapeSessions)
    .values({
      trigger: 'manual',
      status: 'completed',
      accountIds: '[]',
      startedAt: '2026-03-16T08:00:00Z',
      completedAt: '2026-03-16T08:02:00Z',
      ...overrides,
    })
    .returning()
    .get();
}

function insertScrapeLog(
  accountId: number,
  sessionId: number,
  overrides: Partial<typeof schema.scrapeLogs.$inferInsert> = {},
) {
  return testDb.db
    .insert(schema.scrapeLogs)
    .values({
      accountId,
      sessionId,
      status: 'success',
      transactionsFound: 10,
      transactionsNew: 2,
      ...overrides,
    })
    .returning()
    .get();
}

describe('getLatestScrapeTransactions', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb?.close();
  });

  it('returns error when no completed sessions exist', () => {
    const result = JSON.parse(getLatestScrapeTransactions());
    expect(result).toEqual({ error: 'No completed scrape sessions found' });
  });

  it('ignores non-completed sessions', () => {
    insertSession({ status: 'running' });
    insertSession({ status: 'error' });

    const result = JSON.parse(getLatestScrapeTransactions());
    expect(result).toEqual({ error: 'No completed scrape sessions found' });
  });

  it('returns the latest completed session with its transactions', () => {
    const account = insertAccount(testDb.db);

    // Older session
    const oldSession = insertSession({
      completedAt: '2026-03-15T08:00:00Z',
    });
    insertTransaction(testDb.db, account.id, {
      description: 'Old Txn',
      scrapeSessionId: oldSession.id,
    });

    // Latest session
    const newSession = insertSession({
      completedAt: '2026-03-16T08:00:00Z',
    });
    insertScrapeLog(account.id, newSession.id, {
      transactionsFound: 5,
      transactionsNew: 1,
    });
    insertTransaction(testDb.db, account.id, {
      description: 'New Txn',
      scrapeSessionId: newSession.id,
    });

    const result = JSON.parse(getLatestScrapeTransactions());

    expect(result.session.id).toBe(newSession.id);
    expect(result.newTransactions).toHaveLength(1);
    expect(result.newTransactions[0].description).toBe('New Txn');
    expect(result.newTransactions[0].accountName).toBe('Test Bank');
    expect(result.totalNew).toBe(1);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].transactionsNew).toBe(1);
  });

  it('returns session info with zero transactions when all were duplicates', () => {
    const account = insertAccount(testDb.db);
    const session = insertSession();
    insertScrapeLog(account.id, session.id, {
      transactionsFound: 10,
      transactionsNew: 0,
    });
    // No transactions linked to this session

    const result = JSON.parse(getLatestScrapeTransactions());

    expect(result.session.id).toBe(session.id);
    expect(result.newTransactions).toHaveLength(0);
    expect(result.totalNew).toBe(0);
  });

  it('includes error info for failed accounts in a multi-account session', () => {
    const goodAccount = insertAccount(testDb.db, { displayName: 'Good Bank' });
    const badAccount = insertAccount(testDb.db, { displayName: 'Bad Bank' });
    const session = insertSession();

    insertScrapeLog(goodAccount.id, session.id, {
      status: 'success',
      transactionsFound: 5,
      transactionsNew: 2,
    });
    insertScrapeLog(badAccount.id, session.id, {
      status: 'error',
      transactionsFound: 0,
      transactionsNew: 0,
      errorType: 'TIMEOUT',
      errorMessage: 'Login timed out',
    });
    insertTransaction(testDb.db, goodAccount.id, {
      scrapeSessionId: session.id,
    });

    const result = JSON.parse(getLatestScrapeTransactions());

    expect(result.accounts).toHaveLength(2);
    const errorAccount = result.accounts.find(
      (a: { displayName: string }) => a.displayName === 'Bad Bank',
    );
    expect(errorAccount.status).toBe('error');
    expect(errorAccount.errorType).toBe('TIMEOUT');
  });
});
