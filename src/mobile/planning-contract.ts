import { z } from 'zod';
import {
  bootstrapFinancialDateSchema,
  bootstrapInstantSchema,
  bootstrapMoneySchema,
  findBootstrapRedactionViolations,
} from './bootstrap-contract.js';
import { MOBILE_API_VERSION, MOBILE_PROTOCOL_VERSION, MOBILE_RESPONSE_SOURCE } from './contract.js';
import { isMobilePublicId, type MobilePublicIdKind } from './mobile-public-id.js';

const publicId = (kind: MobilePublicIdKind) =>
  z.string().refine((value) => isMobilePublicId(value, kind), `Expected a ${kind} public ID`);
const mask = z.string().regex(/^(?:••••|\*{4}) [A-Za-z0-9]{2,4}$/);

const accountSchema = z
  .object({
    id: publicId('account'),
    institutionName: z.string().trim().min(1).max(80),
    displayName: z.string().trim().min(1).max(80),
    type: z.enum(['bank', 'credit_card', 'unknown']),
    identifierMask: mask,
    currencyCode: z.literal('ILS'),
    state: z.enum(['active', 'inactive', 'unknown']),
    freshness: z
      .object({ status: z.enum(['current', 'stale', 'unknown']), lastSuccessfulSyncAt: bootstrapInstantSchema.nullable() })
      .strict(),
    // Credit-card amounts are intentionally unavailable until the Mac has a
    // reliable amount-due model. This nullable field makes that absence explicit.
    balance: bootstrapMoneySchema.strict().nullable(),
  })
  .strict()
  .superRefine((account, context) => {
    if (account.type === 'credit_card' && account.balance !== null) {
      context.addIssue({ code: 'custom', path: ['balance'], message: 'Credit-card balance is unavailable' });
    }
  });

export const mobileBudgetSchema = z
  .object({
    id: publicId('budget'),
    displayName: z.string().trim().min(1).max(80),
    period: z.enum(['monthly', 'yearly']),
    periodRange: z.object({ startDate: bootstrapFinancialDateSchema, endDate: bootstrapFinancialDateSchema }).strict(),
    limit: bootstrapMoneySchema.strict(),
    spent: bootstrapMoneySchema.strict(),
    remaining: bootstrapMoneySchema.strict(),
    state: z.enum(['on_track', 'watch', 'at_limit', 'over_budget', 'unavailable']),
    pace: z
      .object({
        elapsedDays: z.number().int().positive(),
        totalDays: z.number().int().positive(),
        expectedSpent: bootstrapMoneySchema.strict(),
        projectedSpent: bootstrapMoneySchema.strict(),
        state: z.enum(['on_track', 'ahead', 'behind', 'unavailable']),
      })
      .strict(),
    includedCategories: z.array(z.object({ id: publicId('category'), label: z.string().trim().min(1).max(80) }).strict()).max(100),
  })
  .strict();

const assetSchema = z
  .object({
    id: publicId('asset'),
    displayName: z.string().trim().min(1).max(100),
    type: z.string().trim().min(1).max(40),
    liquidity: z.enum(['liquid', 'illiquid', 'unknown']),
    currentValue: bootstrapMoneySchema.strict().nullable(),
    state: z.enum(['available', 'unavailable']),
  })
  .strict();

const syncSchema = z
  .object({
    state: z.enum(['neverRun', 'queued', 'running', 'completed', 'partial', 'attentionNeeded', 'cancelled', 'failed']),
    startedAt: bootstrapInstantSchema.nullable(),
    completedAt: bootstrapInstantSchema.nullable(),
    accountsSucceeded: z.number().int().nonnegative(),
    accountsAttentionNeeded: z.number().int().nonnegative(),
  })
  .strict();

export const mobilePlanningSnapshotEnvelopeSchema = z
  .object({
    data: z
      .object({
        financialDate: bootstrapFinancialDateSchema,
        calculatedAt: bootstrapInstantSchema,
        baseCurrencyCode: z.literal('ILS'),
        budgets: z.array(mobileBudgetSchema).max(100),
        netWorth: z
          .object({
            state: z.enum(['available', 'partial', 'unavailable']),
            total: bootstrapMoneySchema.strict().nullable(),
            assetsTotal: bootstrapMoneySchema.strict().nullable(),
            liabilitiesTotal: bootstrapMoneySchema.strict().nullable(),
            bankBalancesTotal: bootstrapMoneySchema.strict().nullable(),
          })
          .strict(),
        accounts: z.array(accountSchema).max(100),
        assets: z.array(assetSchema).max(100),
        latestSync: syncSchema,
      })
      .strict(),
    meta: z
      .object({
        apiVersion: z.literal(MOBILE_API_VERSION),
        generatedAt: bootstrapInstantSchema,
        source: z.literal(MOBILE_RESPONSE_SOURCE),
        server: z.object({ id: z.string().uuid(), protocolVersion: z.literal(MOBILE_PROTOCOL_VERSION) }).strict(),
      })
      .strict(),
  })
  .strict();

export type MobilePlanningSnapshotEnvelope = z.infer<typeof mobilePlanningSnapshotEnvelopeSchema>;
export type MobilePlanningSnapshot = MobilePlanningSnapshotEnvelope['data'];

export function validateMobilePlanningSnapshotEnvelope(input: unknown): { success: true; data: MobilePlanningSnapshotEnvelope } | { success: false } {
  if (findBootstrapRedactionViolations(input).length > 0) return { success: false };
  const parsed = mobilePlanningSnapshotEnvelopeSchema.safeParse(input);
  return parsed.success ? { success: true, data: parsed.data } : { success: false };
}
