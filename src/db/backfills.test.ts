import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertAccount, insertTransaction } from '../__tests__/helpers/fixtures.js';
import * as schema from './schema.js';

vi.mock('../scraper/scraper.service.js', () => ({
  MANUAL_LOGIN_COMPANIES: new Set(['isracard', 'amex']),
}));

const { runBackfills } = await import('./backfills.js');

let testDb: TestDb;

describe('database backfills', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb?.close();
  });

  it('repairs unassigned transaction ownership from account members while preserving manual owners', () => {
    const account = insertAccount(testDb.db, { memberId: 1 });
    const unassigned = insertTransaction(testDb.db, account.id, {
      expenseOwnerType: 'unassigned',
      expenseOwnerMemberId: null,
      ownerSource: 'unassigned',
      ownerConfidence: null,
    });
    const manual = insertTransaction(testDb.db, account.id, {
      expenseOwnerType: 'shared',
      expenseOwnerMemberId: null,
      ownerSource: 'manual',
      ownerConfidence: 1,
    });

    runBackfills(testDb.db, testDb.sqlite);

    const updatedUnassigned = testDb.db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.id, unassigned.id))
      .get();
    const updatedManual = testDb.db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.id, manual.id))
      .get();

    expect(updatedUnassigned?.expenseOwnerType).toBe('member');
    expect(updatedUnassigned?.expenseOwnerMemberId).toBe(1);
    expect(updatedUnassigned?.ownerSource).toBe('account');
    expect(updatedUnassigned?.ownerConfidence).toBe(1);

    expect(updatedManual?.expenseOwnerType).toBe('shared');
    expect(updatedManual?.expenseOwnerMemberId).toBeNull();
    expect(updatedManual?.ownerSource).toBe('manual');
  });
});
