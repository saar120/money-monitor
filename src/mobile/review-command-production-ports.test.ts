import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertAccount, insertCategory, insertTransaction } from '../__tests__/helpers/fixtures.js';
import * as schema from '../db/schema.js';
import { createMobilePublicIdProjector } from './mobile-public-id.js';
import { createProductionMobileReviewCommandPorts } from './review-command-production-ports.js';

const KEY = 'private-public-id-key-material-that-is-at-least-32-chars';
const NOW = new Date('2026-07-18T12:00:00.000Z');
const DEVICE = { id: 'device-1', name: 'iPhone', capabilities: ['mobile.review.write'], protocolVersion: 1, tokenVersion: 1, createdAt: NOW.toISOString(), lastUsedAt: null, expiresAt: null, rotatedAt: null, revokedAt: null };

describe('production mobile review command ports', () => {
  const databases: TestDb[] = [];
  afterEach(() => databases.splice(0).forEach((database) => database.close()));

  it('records a confirmed command once and returns the same result on exact replay', () => {
    const database = createTestDb(); databases.push(database);
    database.db.insert(schema.mobileDevices).values({ id: DEVICE.id, name: DEVICE.name, tokenDigest: 'a'.repeat(64), capabilities: JSON.stringify(DEVICE.capabilities), protocolVersion: 1, createdAt: NOW.toISOString() }).run();
    const account = insertAccount(database.db);
    const transaction = insertTransaction(database.db, account.id, { needsReview: true });
    const category = insertCategory(database.db, { name: 'phase4-food', label: 'Phase 4 Food' });
    const project = createMobilePublicIdProjector(KEY);
    const resolveReview = vi.fn(() => ({ needsReview: false }));
    const ports = createProductionMobileReviewCommandPorts({ db: database.db, publicIdKey: KEY, clock: () => NOW, resolveReview });
    const command = { idempotencyKey: 'command_key_1234567890', transactionId: project('transaction', transaction.id), categoryId: project('category', category.id), expectedNeedsReview: true as const };

    expect(ports.resolve(command, { requestId: 'request-1' }, DEVICE)).toEqual({ outcome: 'confirmed', transactionId: command.transactionId, needsReview: false });
    expect(ports.resolve(command, { requestId: 'request-2' }, DEVICE)).toEqual({ outcome: 'confirmed', transactionId: command.transactionId, needsReview: false });
    expect(resolveReview).toHaveBeenCalledOnce();
    expect(database.db.select().from(schema.mobileCommandReceipts).all()).toHaveLength(1);
    expect(database.db.select().from(schema.mobileCommandAuditEvents).all()).toHaveLength(1);
  });

  it('rejects reuse of an idempotency key for a different command', () => {
    const database = createTestDb(); databases.push(database);
    database.db.insert(schema.mobileDevices).values({ id: DEVICE.id, name: DEVICE.name, tokenDigest: 'a'.repeat(64), capabilities: JSON.stringify(DEVICE.capabilities), protocolVersion: 1, createdAt: NOW.toISOString() }).run();
    const account = insertAccount(database.db);
    const transaction = insertTransaction(database.db, account.id, { needsReview: true });
    const category = insertCategory(database.db, { name: 'phase4-food', label: 'Phase 4 Food' });
    const project = createMobilePublicIdProjector(KEY);
    const ports = createProductionMobileReviewCommandPorts({ db: database.db, publicIdKey: KEY, resolveReview: () => ({ needsReview: false }) });
    const command = { idempotencyKey: 'command_key_1234567890', transactionId: project('transaction', transaction.id), categoryId: project('category', category.id), expectedNeedsReview: true as const };
    ports.resolve(command, { requestId: 'request-1' }, DEVICE);

    expect(ports.resolve({ ...command, categoryId: 'category_zyxwvutsrqponmlkjihgf' }, { requestId: 'request-2' }, DEVICE)).toMatchObject({ outcome: 'conflict', needsReview: true });
  });

  it('skips a review once without changing the transaction category', () => {
    const database = createTestDb(); databases.push(database);
    database.db.insert(schema.mobileDevices).values({ id: DEVICE.id, name: DEVICE.name, tokenDigest: 'a'.repeat(64), capabilities: JSON.stringify(DEVICE.capabilities), protocolVersion: 1, createdAt: NOW.toISOString() }).run();
    const account = insertAccount(database.db);
    const category = insertCategory(database.db, { name: 'keep-this-category', label: 'Keep this category' });
    const transaction = insertTransaction(database.db, account.id, { category: category.name, needsReview: true, reviewReason: 'Needs review' });
    const project = createMobilePublicIdProjector(KEY);
    const ports = createProductionMobileReviewCommandPorts({ db: database.db, publicIdKey: KEY, resolveReview: () => ({ needsReview: false }) });
    const command = { idempotencyKey: 'skip_command_key_123456', transactionId: project('transaction', transaction.id), expectedNeedsReview: true as const };

    expect(ports.skip(command, { requestId: 'request-1' }, DEVICE)).toEqual({ outcome: 'confirmed', transactionId: command.transactionId, needsReview: false });
    expect(ports.skip(command, { requestId: 'request-2' }, DEVICE)).toEqual({ outcome: 'confirmed', transactionId: command.transactionId, needsReview: false });
    expect(database.db.select({ category: schema.transactions.category, needsReview: schema.transactions.needsReview, reviewReason: schema.transactions.reviewReason }).from(schema.transactions).where(eq(schema.transactions.id, transaction.id)).get()).toEqual({ category: category.name, needsReview: false, reviewReason: null });
    expect(database.db.select().from(schema.mobileCommandReceipts).all()).toHaveLength(1);
    expect(database.db.select().from(schema.mobileCommandReceipts).get()).toMatchObject({ commandType: 'review.skip' });
  });

  it('rolls back the review change and receipt when the resolver fails', () => {
    const database = createTestDb(); databases.push(database);
    database.db.insert(schema.mobileDevices).values({ id: DEVICE.id, name: DEVICE.name, tokenDigest: 'a'.repeat(64), capabilities: JSON.stringify(DEVICE.capabilities), protocolVersion: 1, createdAt: NOW.toISOString() }).run();
    const account = insertAccount(database.db);
    const transaction = insertTransaction(database.db, account.id, { needsReview: true });
    const category = insertCategory(database.db, { name: 'phase4-food', label: 'Phase 4 Food' });
    const project = createMobilePublicIdProjector(KEY);
    const ports = createProductionMobileReviewCommandPorts({
      db: database.db,
      publicIdKey: KEY,
      resolveReview: (transactionID) => {
        database.db.update(schema.transactions).set({ needsReview: false }).where(eq(schema.transactions.id, transactionID)).run();
        throw new Error('resolver failed');
      },
    });
    const command = { idempotencyKey: 'command_key_1234567890', transactionId: project('transaction', transaction.id), categoryId: project('category', category.id), expectedNeedsReview: true as const };

    expect(() => ports.resolve(command, { requestId: 'request-1' }, DEVICE)).toThrow('resolver failed');
    expect(database.db.select().from(schema.mobileCommandReceipts).all()).toHaveLength(0);
    expect(database.db.select({ needsReview: schema.transactions.needsReview }).from(schema.transactions).where(eq(schema.transactions.id, transaction.id)).get()).toEqual({ needsReview: true });
  });
});
