import { z } from 'zod';
import { MOBILE_API_VERSION, MOBILE_PROTOCOL_VERSION, MOBILE_RESPONSE_SOURCE } from './contract.js';

const publicTransactionId = z.string().regex(/^transaction_[A-Za-z0-9_-]{22}$/);
const publicCategoryId = z.string().regex(/^category_[A-Za-z0-9_-]{22}$/);
const idempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);

/** The first intentionally narrow Phase 4 mutation: resolve one review item. */
export const mobileReviewResolveCommandSchema = z.object({
  idempotencyKey,
  transactionId: publicTransactionId,
  categoryId: publicCategoryId,
  expectedNeedsReview: z.literal(true),
}).strict();
export type MobileReviewResolveCommand = z.infer<typeof mobileReviewResolveCommandSchema>;

/** Deliberately clears the review flag without changing any transaction field. */
export const mobileReviewSkipCommandSchema = z.object({
  idempotencyKey,
  transactionId: publicTransactionId,
  expectedNeedsReview: z.literal(true),
}).strict();
export type MobileReviewSkipCommand = z.infer<typeof mobileReviewSkipCommandSchema>;

export const mobileReviewCommandResultSchema = z.object({
  outcome: z.enum(['confirmed', 'validationFailed', 'conflict']),
  transactionId: publicTransactionId,
  needsReview: z.boolean(),
}).strict();
export type MobileReviewCommandResult = z.infer<typeof mobileReviewCommandResultSchema>;

export const mobileReviewCommandEnvelopeSchema = z.object({
  data: mobileReviewCommandResultSchema,
  meta: z.object({
    apiVersion: z.literal(MOBILE_API_VERSION),
    generatedAt: z.string().datetime({ precision: 3 }),
    source: z.literal(MOBILE_RESPONSE_SOURCE),
    server: z.object({ id: z.string().uuid(), protocolVersion: z.literal(MOBILE_PROTOCOL_VERSION) }).strict(),
  }).strict(),
}).strict();
