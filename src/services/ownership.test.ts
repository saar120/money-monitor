import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import {
  insertAccount,
  insertCategory,
  insertMember,
  insertTransaction,
} from '../__tests__/helpers/fixtures.js';

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

const { applyOwnership, createOwnershipRule, setTransactionOwner } = await import('./ownership.js');
const { listTransactions } = await import('./transactions.js');

describe('ownership service', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterAll(() => {
    testDb?.close();
  });

  it('uses account member as the default owner', () => {
    const member = insertMember(testDb.db, { name: 'Dana' });
    const account = insertAccount(testDb.db, { memberId: member.id });
    const tx = insertTransaction(testDb.db, account.id);

    applyOwnership({ ids: [tx.id] });

    const [updated] = listTransactions({
      ownerType: 'member',
      ownerMemberId: member.id,
    }).transactions;
    expect(updated.id).toBe(tx.id);
    expect(updated.ownerSource).toBe('account');
  });

  it('lets category default owner override account member', () => {
    insertCategory(testDb.db, {
      name: 'rent',
      label: 'Rent',
      defaultOwnerType: 'shared',
      defaultOwnerMemberId: null,
    });
    const account = insertAccount(testDb.db, { memberId: 1 });
    const tx = insertTransaction(testDb.db, account.id, { category: 'rent' });

    applyOwnership({ ids: [tx.id] });

    const [updated] = listTransactions({ ownerType: 'shared' }).transactions;
    expect(updated.id).toBe(tx.id);
    expect(updated.ownerSource).toBe('category');
  });

  it('lets ownership rules override category defaults', () => {
    const member = insertMember(testDb.db, { name: 'Roni' });
    insertCategory(testDb.db, {
      name: 'groceries',
      label: 'Groceries',
      defaultOwnerType: 'shared',
      defaultOwnerMemberId: null,
    });
    const account = insertAccount(testDb.db, { memberId: 1 });
    const tx = insertTransaction(testDb.db, account.id, {
      category: 'groceries',
      description: 'Personal store',
    });

    const rule = createOwnershipRule({
      name: 'Personal store',
      descriptionContains: 'Personal',
      targetOwnerType: 'member',
      targetOwnerMemberId: member.id,
    });
    expect(rule.ok).toBe(true);

    applyOwnership({ ids: [tx.id] });

    const [updated] = listTransactions({
      ownerType: 'member',
      ownerMemberId: member.id,
    }).transactions;
    expect(updated.id).toBe(tx.id);
    expect(updated.ownerSource).toBe('rule');
  });

  it('preserves manual transaction ownership unless forced', () => {
    const member = insertMember(testDb.db, { name: 'Noa' });
    const account = insertAccount(testDb.db, { memberId: 1 });
    const tx = insertTransaction(testDb.db, account.id);

    const manual = setTransactionOwner(tx.id, { type: 'member', memberId: member.id });
    expect(manual.ok).toBe(true);

    applyOwnership({ ids: [tx.id] });
    let [updated] = listTransactions({
      ownerType: 'member',
      ownerMemberId: member.id,
    }).transactions;
    expect(updated.id).toBe(tx.id);
    expect(updated.ownerSource).toBe('manual');

    applyOwnership({ ids: [tx.id], force: true });
    [updated] = listTransactions({ ownerType: 'member', ownerMemberId: 1 }).transactions;
    expect(updated.id).toBe(tx.id);
    expect(updated.ownerSource).toBe('account');
  });
});
