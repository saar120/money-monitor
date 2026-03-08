import { describe, it, expect, afterAll } from 'vitest';
import { createTestDb } from './helpers/db.js';
import { insertAccount, insertTransaction } from './helpers/fixtures.js';

describe('Test infrastructure smoke test', () => {
  const { db, close } = createTestDb();
  afterAll(() => close());

  it('creates a test database with migrations applied', () => {
    const account = insertAccount(db);
    expect(account.id).toBe(1);
    expect(account.companyId).toBe('hapoalim');
  });

  it('inserts and retrieves transactions', () => {
    const account = insertAccount(db, { displayName: 'Smoke Account' });
    const tx = insertTransaction(db, account.id, { description: 'Smoke Test', chargedAmount: -50 });
    expect(tx.id).toBeGreaterThan(0);
    expect(tx.chargedAmount).toBe(-50);
  });

  it('enforces foreign key constraints', () => {
    expect(() => { insertTransaction(db, 999999); }).toThrow();
  });
});
