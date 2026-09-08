import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import {
  insertAccount,
  insertCategory,
  insertMember,
  insertTransaction,
} from '../__tests__/helpers/fixtures.js';
import * as schema from '../db/schema.js';
import { createMobilePublicIdProjector } from './mobile-public-id.js';
import { mobileTransactionQuerySchema } from './transaction-contract.js';
import { MobileTransactionCursorError } from './transaction-cursor.js';
import { createProductionMobileTransactionPorts } from './transaction-production-ports.js';

const KEY = 'production-mobile-public-id-key-32-chars-minimum';
const CONTEXT = {
  generatedAt: '2026-07-16T08:00:00.000Z',
  financialDate: '2026-07-16',
};
const project = createMobilePublicIdProjector(KEY);

describe('production mobile transaction ports', () => {
  const databases: TestDb[] = [];

  function database(): TestDb {
    const value = createTestDb();
    databases.push(value);
    return value;
  }

  function ports(testDb: TestDb) {
    return createProductionMobileTransactionPorts({ db: testDb.db, publicIdKey: KEY });
  }

  function query(input: Record<string, unknown> = {}) {
    return mobileTransactionQuerySchema.parse(input);
  }

  afterEach(() => {
    databases.splice(0).forEach((value) => value.close());
  });

  it('projects the exact safe list/detail fields without mutating authoritative rows', () => {
    const testDb = database();
    const member = insertMember(testDb.db, { name: 'Saar' });
    const account = insertAccount(testDb.db, {
      memberId: member.id,
      displayName: 'Primary Account',
      accountNumber: '123-4567890123456',
      credentialsRef: 'FORBIDDEN_SECRET_SENTINEL',
    });
    const category = insertCategory(testDb.db, { name: 'groceries', label: 'Groceries' });
    const transaction = insertTransaction(testDb.db, account.id, {
      date: '2026-07-15',
      processedDate: '2026-07-15',
      description: '  רמי   לוי Market  ',
      chargedAmount: -42.5,
      chargedCurrency: '₪',
      category: category.name,
      status: 'completed',
      needsReview: true,
      ignored: true,
      memo: 'PRIVATE_MEMO_SENTINEL',
      meta: 'PRIVATE_META_SENTINEL',
      ownerSource: 'manual',
      ownerConfidence: 0.75,
      ownerReviewReason: 'PRIVATE_OWNER_REASON',
      expenseOwnerType: 'member',
      expenseOwnerMemberId: member.id,
      hash: 'PRIVATE_HASH_SENTINEL',
    });
    const before = testDb.db.select().from(schema.transactions).all();
    const read = ports(testDb);

    expect(read.list(query(), CONTEXT).transactions).toEqual([]);
    const list = read.list(query({ includeExcluded: true }), CONTEXT);
    const detail = read.detail(project('transaction', transaction.id), CONTEXT);

    expect(list.transactions).toEqual([
      {
        id: project('transaction', transaction.id),
        occurredOn: '2026-07-15',
        displayName: 'רמי לוי Market',
        amount: { value: '42.50', currencyCode: 'ILS' },
        direction: 'debit',
        status: 'posted',
        category: { id: project('category', category.id), label: 'Groceries' },
        account: {
          id: project('account', account.id),
          displayName: 'Primary Account',
          identifierMask: '•••• 3456',
        },
        needsReview: true,
        excludedFromReports: true,
      },
    ]);
    expect(detail).toEqual({
      ...list.transactions[0],
      owner: { kind: 'member', displayName: 'Saar' },
    });
    const serialized = JSON.stringify({ list, detail });
    for (const forbidden of [
      '123-4567890123456',
      'FORBIDDEN_SECRET_SENTINEL',
      'PRIVATE_MEMO_SENTINEL',
      'PRIVATE_META_SENTINEL',
      'PRIVATE_OWNER_REASON',
      'PRIVATE_HASH_SENTINEL',
      'ownerConfidence',
      'accountNumber',
      'accountId',
      'credentialsRef',
      'transactionId',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(testDb.db.select().from(schema.transactions).all()).toEqual(before);
  });

  it('paginates same-date rows by encrypted keyset without duplicates or insertion drift', () => {
    const testDb = database();
    const account = insertAccount(testDb.db, { memberId: null });
    Array.from({ length: 5 }, (_, index) =>
      insertTransaction(testDb.db, account.id, {
        date: '2026-07-15',
        processedDate: '2026-07-15',
        description: `Transaction ${index + 1}`,
      }),
    );
    const read = ports(testDb);
    const first = read.list(query({ limit: 2 }), CONTEXT);
    expect(first.page.hasMore).toBe(true);
    expect(first.page.nextCursor).toMatch(/^cursor_v1_/);

    insertTransaction(testDb.db, account.id, {
      date: '2026-07-14',
      processedDate: '2026-07-14',
      description: 'Backfilled after page one',
    });
    const secondQuery = query({ limit: 2, cursor: first.page.nextCursor });
    const second = read.list(secondQuery, CONTEXT);
    const repeated = read.list(secondQuery, CONTEXT);
    const third = read.list(query({ limit: 2, cursor: second.page.nextCursor }), CONTEXT);
    expect(repeated.transactions).toEqual(second.transactions);
    expect(
      new Set(
        [...first.transactions, ...second.transactions, ...third.transactions].map((v) => v.id),
      ).size,
    ).toBe(5);
    expect([...first.transactions, ...second.transactions, ...third.transactions]).toHaveLength(5);
    expect(third.page).toEqual({ hasMore: false, nextCursor: null });
  });

  it('rejects tampered and cross-filter cursors before returning another page', () => {
    const testDb = database();
    const account = insertAccount(testDb.db, { memberId: null });
    for (let index = 0; index < 3; index += 1) {
      insertTransaction(testDb.db, account.id, {
        date: '2026-07-15',
        processedDate: '2026-07-15',
      });
    }
    const read = ports(testDb);
    const cursor = read.list(query({ limit: 1 }), CONTEXT).page.nextCursor as string;
    const tail = cursor.at(-1) === 'A' ? 'B' : 'A';

    expect(() =>
      read.list(query({ limit: 1, cursor: `${cursor.slice(0, -1)}${tail}` }), CONTEXT),
    ).toThrow(MobileTransactionCursorError);
    expect(() => read.list(query({ limit: 1, cursor, direction: 'debit' }), CONTEXT)).toThrow(
      MobileTransactionCursorError,
    );
    expect(() =>
      read.list(query({ limit: 1, cursor }), { ...CONTEXT, financialDate: '2026-07-17' }),
    ).toThrow(MobileTransactionCursorError);
  });

  it('treats mixed Hebrew/English and FTS operators as bounded literal prefix tokens', () => {
    const testDb = database();
    const account = insertAccount(testDb.db, { memberId: null });
    insertTransaction(testDb.db, account.id, {
      date: '2026-07-15',
      processedDate: '2026-07-15',
      description: 'רמי לוי Market OR',
    });
    insertTransaction(testDb.db, account.id, {
      date: '2026-07-15',
      processedDate: '2026-07-15',
      description: 'Other Merchant',
    });
    const read = ports(testDb);

    expect(read.list(query({ q: 'רמי Mar' }), CONTEXT).transactions).toHaveLength(1);
    expect(read.list(query({ q: 'OR' }), CONTEXT).transactions[0].displayName).toContain('OR');
    expect(read.list(query({ q: '"*()' }), CONTEXT).transactions).toEqual([]);
    expect(() => read.list(query({ q: 'Market OR' }), CONTEXT)).not.toThrow();
  });

  it('intersects date, direction, status, review, exclusion, and public account filters', () => {
    const testDb = database();
    const accountOne = insertAccount(testDb.db, { memberId: null });
    const accountTwo = insertAccount(testDb.db, { memberId: null });
    const expected = insertTransaction(testDb.db, accountOne.id, {
      date: '2026-07-10',
      processedDate: '2026-07-10',
      chargedAmount: -50,
      status: 'pending',
      needsReview: true,
    });
    insertTransaction(testDb.db, accountOne.id, {
      date: '2026-07-11',
      processedDate: '2026-07-11',
      chargedAmount: 50,
      status: 'completed',
      needsReview: false,
    });
    insertTransaction(testDb.db, accountTwo.id, {
      date: '2026-07-10',
      processedDate: '2026-07-10',
      chargedAmount: -50,
      status: 'pending',
      needsReview: true,
    });
    const read = ports(testDb);
    const result = read.list(
      query({
        startDate: '2026-07-01',
        endDate: '2026-07-10',
        direction: 'debit',
        status: 'pending',
        needsReview: true,
        accountId: project('account', accountOne.id),
      }),
      CONTEXT,
    );

    expect(result.transactions.map((value) => value.id)).toEqual([
      project('transaction', expected.id),
    ]);
    expect(
      read.list(query({ accountId: project('account', 999_999) }), CONTEXT).transactions,
    ).toEqual([]);
  });

  it('excludes future installment rows before limiting and hides future detail', () => {
    const testDb = database();
    const account = insertAccount(testDb.db, { memberId: null });
    const occurred = insertTransaction(testDb.db, account.id, {
      date: CONTEXT.financialDate,
      processedDate: CONTEXT.financialDate,
      description: 'Occurred today',
    });
    const future = insertTransaction(testDb.db, account.id, {
      date: '2026-08-01',
      processedDate: '2026-08-01',
      description: 'Future installment',
      installmentNumber: 2,
      installmentTotal: 3,
    });
    const read = ports(testDb);

    expect(read.list(query({ limit: 1 }), CONTEXT).transactions[0].id).toBe(
      project('transaction', occurred.id),
    );
    expect(read.detail(project('transaction', future.id), CONTEXT)).toBeNull();
    expect(read.detail(project('transaction', 999_999), CONTEXT)).toBeNull();
  });
});
