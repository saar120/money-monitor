import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertAccount, insertMember, insertTransaction } from '../__tests__/helpers/fixtures.js';
import { transactions } from '../db/schema.js';
import type { ScraperTransaction } from '../shared/types.js';
import { computeLegacyTransactionHash } from '../services/transaction-identity.js';

let testDb: TestDb;
const scrape = vi.fn();

vi.mock('../db/connection.js', () => ({
  get db() {
    return testDb.db;
  },
}));
vi.mock('israeli-bank-scrapers-core', () => ({
  CompanyTypes: { oneZero: 'oneZero' },
  createScraper: () => ({ scrape }),
}));
vi.mock('./credential-store.js', () => ({ getCredentials: () => ({}) }));
vi.mock('./chromium.js', () => ({ ensureChromium: async () => '/chromium' }));
vi.mock('../ai/agent.js', () => ({ batchCategorize: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/ownership.js', () => ({ applyOwnership: vi.fn() }));

const { scrapeAccount } = await import('./scraper.service.js');

function scraped(description: string, amount: number, date = '2026-01-15'): ScraperTransaction {
  return {
    type: 'normal',
    status: 'completed',
    date,
    processedDate: date,
    originalAmount: amount,
    originalCurrency: 'ILS',
    chargedAmount: amount,
    description,
  };
}

describe('One Zero scraper after statement import', () => {
  beforeEach(() => {
    testDb?.close();
    testDb = createTestDb();
    scrape.mockReset();
  });

  it('links unique and repeated-amount movements while preserving imported edits', async () => {
    const member = insertMember(testDb.db);
    const account = insertAccount(testDb.db, {
      companyId: 'oneZero',
      memberId: member.id,
      accountNumber: 'test-account',
    });
    const first = insertTransaction(testDb.db, account.id, {
      date: '2026-01-15',
      processedDate: '2026-01-15',
      chargedAmount: -123.45,
      originalAmount: -123.45,
      description: 'העברה ל/נועה דוגמה/בדיקה',
      meta: '{"oneZeroReference":"test-ref-a"}',
      category: 'transfer',
      ignored: true,
    });
    const second = insertTransaction(testDb.db, account.id, {
      date: '2026-01-15',
      processedDate: '2026-01-15',
      chargedAmount: -123.45,
      originalAmount: -123.45,
      description: 'העברה ל/תמר דוגמה/בדיקה',
      meta: '{"oneZeroReference":"test-ref-b"}',
      category: 'transfer',
      ignored: true,
    });
    const third = insertTransaction(testDb.db, account.id, {
      date: '2026-01-16',
      processedDate: '2026-01-16',
      chargedAmount: -67.89,
      originalAmount: -67.89,
      description: 'חיוב/שירות בדיקה',
      meta: '{"oneZeroReference":"test-ref-c"}',
      category: 'other',
    });
    scrape.mockResolvedValue({
      success: true,
      accounts: [
        {
          accountNumber: 'test-account',
          txns: [
            scraped('העברה לתמר דוגמה', -123.45),
            scraped('העברה לנועה דוגמה', -123.45),
            scraped('שירות בדיקה', -67.89, '2026-01-16'),
          ],
        },
      ],
    });

    const result = await scrapeAccount(account);
    expect(result.results[0]).toMatchObject({ transactionsFound: 3, transactionsNew: 0 });
    const rows = testDb.db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, account.id))
      .all();
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.id === first.id)).toMatchObject({
      category: 'transfer',
      ignored: true,
      meta: first.meta,
    });
    expect(rows.find((row) => row.id === second.id)).toMatchObject({
      category: 'transfer',
      ignored: true,
      meta: second.meta,
    });
    expect(rows.find((row) => row.id === third.id)).toMatchObject({
      category: 'other',
      meta: third.meta,
    });
    expect(rows.find((row) => row.id === first.id)?.hash).toBe(
      computeLegacyTransactionHash(account.id, '2026-01-15', -123.45, 'העברה לנועה דוגמה'),
    );
    expect(rows.find((row) => row.id === second.id)?.hash).toBe(
      computeLegacyTransactionHash(account.id, '2026-01-15', -123.45, 'העברה לתמר דוגמה'),
    );
    expect(rows.find((row) => row.id === third.id)?.hash).toBe(
      computeLegacyTransactionHash(account.id, '2026-01-16', -67.89, 'שירות בדיקה'),
    );

    const repeated = await scrapeAccount(account);
    expect(repeated.results[0]).toMatchObject({ transactionsNew: 0 });
    expect(testDb.db.select().from(transactions).all()).toHaveLength(3);
  });

  it('does not merge indistinguishable same-day payments', async () => {
    const member = insertMember(testDb.db);
    const account = insertAccount(testDb.db, {
      companyId: 'oneZero',
      memberId: member.id,
      accountNumber: 'test-account',
    });
    insertTransaction(testDb.db, account.id, {
      date: '2026-01-15',
      processedDate: '2026-01-15',
      chargedAmount: -10,
      description: 'תשלום בדיקה',
      meta: '{"oneZeroReference":"test-ref-d"}',
    });
    insertTransaction(testDb.db, account.id, {
      date: '2026-01-15',
      processedDate: '2026-01-15',
      chargedAmount: -10,
      description: 'תשלום בדיקה',
      meta: '{"oneZeroReference":"test-ref-e"}',
    });
    scrape.mockResolvedValue({
      success: true,
      accounts: [{ accountNumber: 'test-account', txns: [scraped('תשלום בדיקה', -10)] }],
    });

    const result = await scrapeAccount(account);
    expect(result.results[0]).toMatchObject({ transactionsNew: 1 });
    expect(testDb.db.select().from(transactions).all()).toHaveLength(3);
  });
});
