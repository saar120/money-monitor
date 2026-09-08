import { z } from 'zod';
import {
  bootstrapCurrencyCodeSchema,
  bootstrapFinancialDateSchema,
  bootstrapInstantSchema,
  bootstrapMoneySchema,
  findBootstrapRedactionViolations,
} from './bootstrap-contract.js';
import { MOBILE_API_VERSION, MOBILE_PROTOCOL_VERSION, MOBILE_RESPONSE_SOURCE } from './contract.js';
import { isMobilePublicId } from './mobile-public-id.js';

const transactionIdSchema = z
  .string()
  .refine((value) => isMobilePublicId(value, 'transaction'), 'Expected a transaction public ID');
const accountIdSchema = z
  .string()
  .refine((value) => isMobilePublicId(value, 'account'), 'Expected an account public ID');
const categoryIdSchema = z
  .string()
  .refine((value) => isMobilePublicId(value, 'category'), 'Expected a category public ID');
const identifierMaskSchema = z.string().regex(/^(?:••••|\*{4}) [A-Za-z0-9]{2,4}$/);
const cursorSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^cursor_v1_[A-Za-z0-9_-]+$/);

function queryBooleanSchema() {
  return z.union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')]);
}

const queryIntegerSchema = z.union([
  z.number(),
  z
    .string()
    .regex(/^\d+$/)
    .transform((value) => Number(value)),
]);

const normalizedQuerySchema = z
  .string()
  .transform((value) => value.normalize('NFKC').trim().replace(/\s+/gu, ' '))
  .pipe(z.string().min(1).max(100));

export const mobileTransactionDirectionSchema = z.enum(['debit', 'credit', 'unknown']);
export const mobileTransactionStatusSchema = z.enum(['posted', 'pending', 'unknown']);

export const mobileTransactionQuerySchema = z
  .object({
    q: normalizedQuerySchema.optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: queryIntegerSchema.pipe(z.number().int().min(1).max(50)).default(30),
    startDate: bootstrapFinancialDateSchema.optional(),
    endDate: bootstrapFinancialDateSchema.optional(),
    direction: mobileTransactionDirectionSchema.optional(),
    status: mobileTransactionStatusSchema.optional(),
    needsReview: queryBooleanSchema().optional(),
    includeExcluded: queryBooleanSchema().default(false),
    accountId: accountIdSchema.optional(),
  })
  .strict()
  .superRefine((query, context) => {
    if (query.startDate && query.endDate && query.startDate > query.endDate) {
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'End date cannot precede start date',
      });
    }
  });

export type MobileTransactionQuery = z.infer<typeof mobileTransactionQuerySchema>;

export const mobileTransactionItemSchema = z
  .object({
    id: transactionIdSchema,
    occurredOn: bootstrapFinancialDateSchema,
    displayName: z.string().trim().min(1).max(160),
    amount: bootstrapMoneySchema.strict(),
    direction: mobileTransactionDirectionSchema,
    status: mobileTransactionStatusSchema,
    category: z
      .object({
        id: categoryIdSchema,
        label: z.string().trim().min(1).max(80),
      })
      .strict()
      .nullable(),
    account: z
      .object({
        id: accountIdSchema,
        displayName: z.string().trim().min(1).max(80),
        identifierMask: identifierMaskSchema,
      })
      .strict(),
    needsReview: z.boolean(),
    excludedFromReports: z.boolean(),
  })
  .strict();

export const mobileTransactionOwnerSchema = z
  .object({
    kind: z.enum(['member', 'shared', 'unassigned', 'unknown']),
    displayName: z.string().trim().min(1).max(80).nullable(),
  })
  .strict()
  .superRefine((owner, context) => {
    if ((owner.kind === 'member') !== (owner.displayName !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['displayName'],
        message: 'Only a member owner has a display name',
      });
    }
  });

export const mobileTransactionDetailSchema = mobileTransactionItemSchema
  .extend({ owner: mobileTransactionOwnerSchema })
  .strict();

const mobileTransactionMetaSchema = z
  .object({
    apiVersion: z.literal(MOBILE_API_VERSION),
    generatedAt: bootstrapInstantSchema,
    source: z.literal(MOBILE_RESPONSE_SOURCE),
    server: z
      .object({
        id: z.string().uuid(),
        protocolVersion: z.literal(MOBILE_PROTOCOL_VERSION),
      })
      .strict(),
  })
  .strict();

export const mobileTransactionListEnvelopeSchema = z
  .object({
    data: z
      .object({
        financialDate: bootstrapFinancialDateSchema,
        transactions: z.array(mobileTransactionItemSchema).max(50),
        page: z
          .object({
            hasMore: z.boolean(),
            nextCursor: cursorSchema.nullable(),
          })
          .strict()
          .superRefine((page, context) => {
            if (page.hasMore !== (page.nextCursor !== null)) {
              context.addIssue({
                code: 'custom',
                path: ['nextCursor'],
                message: 'Cursor presence must match hasMore',
              });
            }
          }),
      })
      .strict()
      .superRefine((data, context) => {
        const ids = data.transactions.map((transaction) => transaction.id);
        if (new Set(ids).size !== ids.length) {
          context.addIssue({
            code: 'custom',
            path: ['transactions'],
            message: 'A page cannot contain duplicate transaction IDs',
          });
        }
        data.transactions.forEach((transaction, index) => {
          if (transaction.occurredOn > data.financialDate) {
            context.addIssue({
              code: 'custom',
              path: ['transactions', index, 'occurredOn'],
              message: 'Transaction cannot occur after the finance date',
            });
          }
        });
      }),
    meta: mobileTransactionMetaSchema,
  })
  .strict();

export const mobileTransactionDetailEnvelopeSchema = z
  .object({
    data: z.object({ transaction: mobileTransactionDetailSchema }).strict(),
    meta: mobileTransactionMetaSchema,
  })
  .strict();

export type MobileTransactionItem = z.infer<typeof mobileTransactionItemSchema>;
export type MobileTransactionDetail = z.infer<typeof mobileTransactionDetailSchema>;
export type MobileTransactionListEnvelope = z.infer<typeof mobileTransactionListEnvelopeSchema>;
export type MobileTransactionDetailEnvelope = z.infer<typeof mobileTransactionDetailEnvelopeSchema>;

export interface MobileTransactionValidationIssue {
  code: 'redaction_violation' | 'schema_invalid';
  path: string;
}

export type MobileTransactionValidationResult<T> =
  | { success: true; data: T }
  | { success: false; issues: MobileTransactionValidationIssue[] };

function validateEnvelope<T>(
  input: unknown,
  schema: z.ZodType<T>,
): MobileTransactionValidationResult<T> {
  const redactionViolations = findBootstrapRedactionViolations(input);
  if (redactionViolations.length > 0) {
    return {
      success: false,
      issues: redactionViolations.map((violation) => ({
        code: 'redaction_violation',
        path: violation.path,
      })),
    };
  }

  const parsed = schema.safeParse(input);
  if (parsed.success) return { success: true, data: parsed.data };
  return {
    success: false,
    issues: parsed.error.issues.map((issue) => ({
      code: 'schema_invalid',
      path: issue.path.length > 0 ? `$.${issue.path.map(String).join('.')}` : '$',
    })),
  };
}

export function validateMobileTransactionListEnvelope(
  input: unknown,
): MobileTransactionValidationResult<MobileTransactionListEnvelope> {
  return validateEnvelope(input, mobileTransactionListEnvelopeSchema);
}

export function validateMobileTransactionDetailEnvelope(
  input: unknown,
): MobileTransactionValidationResult<MobileTransactionDetailEnvelope> {
  return validateEnvelope(input, mobileTransactionDetailEnvelopeSchema);
}

// Exported for Swift/server fixture parity tests.
export { bootstrapCurrencyCodeSchema as mobileTransactionCurrencyCodeSchema };
