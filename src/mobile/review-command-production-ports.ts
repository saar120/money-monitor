import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import type { PublicMobileDevice } from './device-registry.js';
import { createMobilePublicIdProjector } from './mobile-public-id.js';
import type { MobileReviewCommandResult, MobileReviewResolveCommand, MobileReviewSkipCommand } from './review-command-contract.js';

type Database = BetterSQLite3Database<typeof schema>;
type Outcome = MobileReviewCommandResult['outcome'];

export interface ProductionMobileReviewCommandPortOptions {
  db: Database;
  publicIdKey: string;
  clock?: () => Date;
  /** Retains the established Mac category/ownership mutation behavior. */
  resolveReview: (transactionID: number, categoryName: string) => { needsReview: boolean } | null;
}

function commandFingerprint(command: MobileReviewResolveCommand): string {
  return createHash('sha256')
    .update(`${command.transactionId}\u0000${command.categoryId}\u0000${command.expectedNeedsReview}`)
    .digest('hex');
}

function skipFingerprint(command: MobileReviewSkipCommand): string {
  return createHash('sha256')
    .update(`${command.transactionId}\u0000${command.expectedNeedsReview}`)
    .digest('hex');
}

function isOutcome(value: string): value is Outcome {
  return value === 'confirmed' || value === 'validationFailed' || value === 'conflict';
}

/** Maps opaque IDs to the Mac-owned review service and persists redacted receipts. */
export function createProductionMobileReviewCommandPorts(options: ProductionMobileReviewCommandPortOptions) {
  const publicID = createMobilePublicIdProjector(options.publicIdKey);
  const clock = options.clock ?? (() => new Date());

  function record(
    database: Database,
    command: MobileReviewResolveCommand,
    device: PublicMobileDevice,
    requestID: string,
    outcome: Outcome,
    needsReview: boolean,
  ): MobileReviewCommandResult {
    database.insert(schema.mobileCommandReceipts).values({
      idempotencyKey: command.idempotencyKey,
      deviceId: device.id,
      commandType: 'review.resolve',
      targetReference: command.transactionId,
      requestFingerprint: commandFingerprint(command),
      outcome,
      resultNeedsReview: needsReview,
      createdAt: clock().toISOString(),
    }).run();
    database.insert(schema.mobileCommandAuditEvents).values({
      deviceId: device.id,
      commandType: 'review.resolve',
      targetReference: command.transactionId,
      requestId: requestID,
      outcome,
      createdAt: clock().toISOString(),
    }).run();
    return { outcome, transactionId: command.transactionId, needsReview };
  }

  function resolve(command: Readonly<MobileReviewResolveCommand>, context: Readonly<{ requestId: string }>, device: PublicMobileDevice): MobileReviewCommandResult {
    // The Electron resolver operates on this same SQLite connection. Keeping the
    // mutation, receipt, and audit event inside one transaction means a thrown
    // resolver cannot leave a completed review without its replay record.
    return options.db.transaction((database) => {
      const existing = database.select().from(schema.mobileCommandReceipts)
        .where(eq(schema.mobileCommandReceipts.idempotencyKey, command.idempotencyKey)).get();
      if (existing) {
        if (existing.deviceId === device.id && existing.commandType === 'review.resolve' && existing.targetReference === command.transactionId && existing.requestFingerprint === commandFingerprint(command) && isOutcome(existing.outcome)) {
          return { outcome: existing.outcome, transactionId: command.transactionId, needsReview: existing.resultNeedsReview };
        }
        database.insert(schema.mobileCommandAuditEvents).values({ deviceId: device.id, commandType: 'review.resolve', targetReference: command.transactionId, requestId: context.requestId, outcome: 'conflict', createdAt: clock().toISOString() }).run();
        return { outcome: 'conflict', transactionId: command.transactionId, needsReview: true };
      }

      const transaction = database.select({ id: schema.transactions.id, needsReview: schema.transactions.needsReview }).from(schema.transactions).all()
        .find((row) => publicID('transaction', row.id) === command.transactionId);
      if (!transaction || !transaction.needsReview) return record(database, command, device, context.requestId, 'conflict', transaction?.needsReview ?? false);
      const category = database.select({ id: schema.categories.id, name: schema.categories.name }).from(schema.categories).all()
        .find((row) => publicID('category', row.id) === command.categoryId);
      if (!category) return record(database, command, device, context.requestId, 'validationFailed', true);

      const updated = options.resolveReview(transaction.id, category.name);
      return record(database, command, device, context.requestId, updated ? 'confirmed' : 'conflict', updated?.needsReview ?? false);
    });
  }

  function skip(command: Readonly<MobileReviewSkipCommand>, context: Readonly<{ requestId: string }>, device: PublicMobileDevice): MobileReviewCommandResult {
    return options.db.transaction((database) => {
      const existing = database.select().from(schema.mobileCommandReceipts)
        .where(eq(schema.mobileCommandReceipts.idempotencyKey, command.idempotencyKey)).get();
      if (existing) {
        if (existing.deviceId === device.id && existing.commandType === 'review.skip' && existing.targetReference === command.transactionId && existing.requestFingerprint === skipFingerprint(command) && isOutcome(existing.outcome)) {
          return { outcome: existing.outcome, transactionId: command.transactionId, needsReview: existing.resultNeedsReview };
        }
        database.insert(schema.mobileCommandAuditEvents).values({ deviceId: device.id, commandType: 'review.skip', targetReference: command.transactionId, requestId: context.requestId, outcome: 'conflict', createdAt: clock().toISOString() }).run();
        return { outcome: 'conflict', transactionId: command.transactionId, needsReview: true };
      }
      const transaction = database.select({ id: schema.transactions.id, needsReview: schema.transactions.needsReview }).from(schema.transactions).all()
        .find((row) => publicID('transaction', row.id) === command.transactionId);
      if (!transaction || !transaction.needsReview) {
        const needsReview = transaction?.needsReview ?? false;
        database.insert(schema.mobileCommandReceipts).values({ idempotencyKey: command.idempotencyKey, deviceId: device.id, commandType: 'review.skip', targetReference: command.transactionId, requestFingerprint: skipFingerprint(command), outcome: 'conflict', resultNeedsReview: needsReview, createdAt: clock().toISOString() }).run();
        database.insert(schema.mobileCommandAuditEvents).values({ deviceId: device.id, commandType: 'review.skip', targetReference: command.transactionId, requestId: context.requestId, outcome: 'conflict', createdAt: clock().toISOString() }).run();
        return { outcome: 'conflict', transactionId: command.transactionId, needsReview };
      }

      {
        database.update(schema.transactions).set({ needsReview: false, reviewReason: null }).where(eq(schema.transactions.id, transaction.id)).run();
      }
      database.insert(schema.mobileCommandReceipts).values({ idempotencyKey: command.idempotencyKey, deviceId: device.id, commandType: 'review.skip', targetReference: command.transactionId, requestFingerprint: skipFingerprint(command), outcome: 'confirmed', resultNeedsReview: false, createdAt: clock().toISOString() }).run();
      database.insert(schema.mobileCommandAuditEvents).values({ deviceId: device.id, commandType: 'review.skip', targetReference: command.transactionId, requestId: context.requestId, outcome: 'confirmed', createdAt: clock().toISOString() }).run();
      return { outcome: 'confirmed', transactionId: command.transactionId, needsReview: false };
    });
  }

  return Object.freeze({ resolve, skip });
}
