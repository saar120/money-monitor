import { z } from 'zod';
import {
  bootstrapCurrencyCodeSchema,
  bootstrapFinancialDateSchema,
  bootstrapInstantSchema,
  bootstrapMoneySchema,
  findBootstrapRedactionViolations,
} from './bootstrap-contract.js';
import { MOBILE_API_VERSION, MOBILE_PROTOCOL_VERSION, MOBILE_RESPONSE_SOURCE } from './contract.js';

const periodSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  label: z.string().min(1).max(40),
  startDate: bootstrapFinancialDateSchema,
  endDate: bootstrapFinancialDateSchema,
  elapsedPercent: z.number().min(0).max(100),
});

const categorySchema = z.object({
  name: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  color: z.string().max(32).nullable(),
  current: bootstrapMoneySchema,
  previous: bootstrapMoneySchema,
  delta: bootstrapMoneySchema,
});

const merchantSchema = z.object({
  name: z.string().min(1).max(160),
  category: z.string().min(1).max(80),
  current: bootstrapMoneySchema,
  previous: bootstrapMoneySchema,
  delta: bootstrapMoneySchema,
  transactionCount: z.number().int().nonnegative(),
});

const budgetSchema = z.object({
  name: z.string().min(1).max(80),
  spent: bootstrapMoneySchema,
  limit: bootstrapMoneySchema,
  remaining: bootstrapMoneySchema,
  usedPercent: z.number().nonnegative(),
  elapsedPercent: z.number().min(0).max(100),
  status: z.enum(['on_track', 'watch', 'over_budget']),
});

export const mobileOverviewQuerySchema = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
    since: bootstrapInstantSchema.optional(),
  })
  .strict();

export const mobileOverviewDataSchema = z.object({
  financialDate: bootstrapFinancialDateSchema,
  currencyCode: bootstrapCurrencyCodeSchema,
  period: periodSchema,
  cashflow: z.object({
    spending: bootstrapMoneySchema,
    income: bootstrapMoneySchema,
    previousSpending: bootstrapMoneySchema,
    paceDelta: bootstrapMoneySchema,
    spendingVsIncomePercent: z.number().nonnegative().nullable(),
  }),
  daily: z
    .array(
      z.object({
        day: z.number().int().min(1).max(31),
        current: bootstrapMoneySchema,
        previous: bootstrapMoneySchema,
      }),
    )
    .max(31),
  categories: z.array(categorySchema).max(30),
  merchants: z.array(merchantSchema).max(30),
  budgets: z.array(budgetSchema).max(20),
  reviewCount: z.number().int().nonnegative(),
  sinceLastVisit: z
    .object({
      transactions: z.number().int().nonnegative(),
      spent: bootstrapMoneySchema,
    })
    .nullable(),
  netWorth: z.object({
    total: bootstrapMoneySchema,
    change: bootstrapMoneySchema.nullable(),
    assets: bootstrapMoneySchema.nullable(),
    liabilities: bootstrapMoneySchema.nullable(),
    history: z
      .array(z.object({ date: bootstrapFinancialDateSchema, total: bootstrapMoneySchema }))
      .max(36),
  }),
});

export const mobileOverviewEnvelopeSchema = z.object({
  data: mobileOverviewDataSchema,
  meta: z.object({
    apiVersion: z.literal(MOBILE_API_VERSION),
    generatedAt: bootstrapInstantSchema,
    source: z.literal(MOBILE_RESPONSE_SOURCE),
    server: z.object({
      id: z.string().uuid(),
      protocolVersion: z.literal(MOBILE_PROTOCOL_VERSION),
    }),
  }),
});

export type MobileOverviewQuery = z.infer<typeof mobileOverviewQuerySchema>;
export type MobileOverviewData = z.infer<typeof mobileOverviewDataSchema>;
export type MobileOverviewEnvelope = z.infer<typeof mobileOverviewEnvelopeSchema>;

export function validateMobileOverviewEnvelope(input: unknown) {
  if (findBootstrapRedactionViolations(input).length > 0) return null;
  const parsed = mobileOverviewEnvelopeSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
