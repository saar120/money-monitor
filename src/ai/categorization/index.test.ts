import { eq } from 'drizzle-orm';
import { config } from '../../config.js';
import { transactions } from '../../db/schema.js';
import { createTestDb, type TestDb } from '../../__tests__/helpers/db.js';
import { insertAccount, insertTransaction } from '../../__tests__/helpers/fixtures.js';

let testDb: TestDb;
const { llmMock, typeSafeMock, applyOwnershipMock } = vi.hoisted(() => ({
  llmMock: vi.fn(),
  typeSafeMock: vi.fn(),
  applyOwnershipMock: vi.fn(),
}));

vi.mock('../../db/connection.js', () => ({
  get db() {
    return testDb.db;
  },
}));
vi.mock('../../services/ownership.js', () => ({ applyOwnership: applyOwnershipMock }));
vi.mock('./llm.js', () => ({ categorizeWithLlm: llmMock }));
vi.mock('./typesafe.js', () => ({ categorizeWithTypeSafe: typeSafeMock }));

const { batchCategorize } = await import('./index.js');

describe('categorization provider seam', () => {
  beforeEach(() => {
    testDb = createTestDb();
    config.CATEGORIZATION_PROVIDER = 'llm';
    llmMock.mockReset();
    typeSafeMock.mockReset();
    applyOwnershipMock.mockReset();
  });

  afterEach(() => testDb.close());

  it('keeps the existing LLM adapter as the default provider', async () => {
    const account = insertAccount(testDb.db);
    const row = insertTransaction(testDb.db, account.id);
    llmMock.mockResolvedValue([{ id: row.id, category: 'food', confidence: 0.9 }]);

    await expect(batchCategorize()).resolves.toEqual({ categorized: 1 });
    expect(llmMock).toHaveBeenCalledOnce();
    expect(typeSafeMock).not.toHaveBeenCalled();
    expect(
      testDb.db.select().from(transactions).where(eq(transactions.id, row.id)).get()?.category,
    ).toBe('food');
  });

  it('uses the existing low-confidence review behavior for TypeSafe predictions', async () => {
    config.CATEGORIZATION_PROVIDER = 'typesafe';
    const account = insertAccount(testDb.db);
    const row = insertTransaction(testDb.db, account.id);
    typeSafeMock.mockResolvedValue([{ id: row.id, category: 'food', confidence: 0.79 }]);

    await batchCategorize();
    const updated = testDb.db.select().from(transactions).where(eq(transactions.id, row.id)).get();
    expect(updated).toMatchObject({
      category: 'food',
      confidence: 0.79,
      needsReview: true,
      reviewReason: 'Low confidence categorization',
    });
    expect(applyOwnershipMock).toHaveBeenCalledWith({ ids: [row.id] });
  });

  it('does not update any transactions when a TypeSafe chunk fails', async () => {
    config.CATEGORIZATION_PROVIDER = 'typesafe';
    const account = insertAccount(testDb.db);
    const first = insertTransaction(testDb.db, account.id);
    const second = insertTransaction(testDb.db, account.id);
    typeSafeMock.mockRejectedValue(new Error('TypeSafe request failed with status 529'));

    await expect(batchCategorize()).rejects.toThrow('status 529');
    const rows = testDb.db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, account.id))
      .all();
    expect(rows.find(({ id }) => id === first.id)?.category).toBeNull();
    expect(rows.find(({ id }) => id === second.id)?.category).toBeNull();
    expect(applyOwnershipMock).not.toHaveBeenCalled();
  });
});
