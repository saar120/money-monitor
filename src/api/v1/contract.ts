import { z } from 'zod';

/**
 * The versioned wire contract is deliberately small at this stage.  Zod
 * schemas are the runtime source of truth; TypeScript callers infer their
 * types from these same values and the OpenAPI document is derived from them.
 */
export const CANONICAL_API_VERSION = '1' as const;
export const CANONICAL_API_PREFIX = '/api/v1' as const;
export const CANONICAL_GENERATED_SOURCE = 'mac-authoritative' as const;

const DECIMAL_TEXT_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
const ISO_CURRENCY_CODES = new Set(Intl.supportedValuesOf('currency'));

export const decimalTextSchema = z
  .string()
  .regex(DECIMAL_TEXT_PATTERN, 'Money values must be decimal text with at most 4 places');

export const currencyCodeSchema = z
  .string()
  .regex(CURRENCY_CODE_PATTERN, 'Currency must be an ISO 4217 code')
  .refine((value) => ISO_CURRENCY_CODES.has(value), 'Currency must be an ISO 4217 code');

export const moneySchema = z
  .object({
    value: decimalTextSchema,
    currencyCode: currencyCodeSchema,
  })
  .strict();

export const entityIdSchema = z.number().int().positive();

export const resourceVersionSchema = z.number().int().min(1);

export const completenessSchema = z.enum(['complete', 'partial']);

export const refreshHintSchema = z
  .object({
    domain: z.string().trim().min(1).max(64),
    resourceIds: z.array(entityIdSchema).max(100),
  })
  .strict();

export const mutationReceiptSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(128),
    replayed: z.boolean(),
  })
  .strict();

export const canonicalMetaSchema = z
  .object({
    apiVersion: z.literal(CANONICAL_API_VERSION),
    generatedAt: z.string().datetime({ offset: true }),
    source: z.literal(CANONICAL_GENERATED_SOURCE),
    calculationVersion: z.string().trim().min(1).max(64).optional(),
    completeness: completenessSchema.optional(),
    estimated: z.boolean().optional(),
    resourceVersion: resourceVersionSchema.optional(),
    refreshHints: z.array(refreshHintSchema).max(20).optional(),
    missingSections: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
    receipt: mutationReceiptSchema.optional(),
  })
  .strict();

const financialDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must use YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Dates must be valid calendar dates');

const financialPeriodSchema = z
  .object({ startDate: financialDateSchema, endDate: financialDateSchema })
  .strict()
  .refine((period) => period.startDate <= period.endDate, 'Period end date cannot precede start date');

const homeDrillDownSchema = z
  .object({
    category: z.string().trim().min(1).max(80).optional(),
    startDate: financialDateSchema,
    endDate: financialDateSchema,
  })
  .strict();

const homeCategorySchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    amount: moneySchema,
    share: z.number().finite().min(0).max(1),
    transactionCount: z.number().int().nonnegative(),
    textSummary: z.string().trim().min(1).max(240),
    drillDown: homeDrillDownSchema,
  })
  .strict();

const homeCashFlowPointSchema = z
  .object({
    period: financialPeriodSchema,
    income: moneySchema,
    expenses: moneySchema,
    net: moneySchema,
    textSummary: z.string().trim().min(1).max(240),
    drillDown: homeDrillDownSchema,
  })
  .strict();

const homeAccountFreshnessSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    status: z.enum(['current', 'stale', 'unknown']),
    lastSuccessfulSyncAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

const homeBudgetSchema = z
  .object({
    state: z.enum(['on_track', 'watch', 'at_limit', 'over_budget', 'unavailable']),
    name: z.string().trim().min(1).max(80),
    spent: moneySchema,
    limit: moneySchema,
    remaining: moneySchema,
    period: financialPeriodSchema,
  })
  .strict();

export const homeOverviewDataSchema = z
  .object({
    financialDate: financialDateSchema,
    calculatedAt: z.string().datetime({ offset: true }),
    baseCurrencyCode: z.literal('ILS'),
    availableMoney: moneySchema.nullable(),
    spending: z
      .object({
        current: z.object({ amount: moneySchema, period: financialPeriodSchema }).strict(),
        comparison: z.object({ amount: moneySchema, period: financialPeriodSchema }).strict(),
        change: moneySchema,
      })
      .strict(),
    budget: homeBudgetSchema.nullable(),
    netWorth: z
      .object({ total: moneySchema.nullable(), liquid: moneySchema.nullable() })
      .strict(),
    categories: z.array(homeCategorySchema).max(100),
    cashFlow: z.array(homeCashFlowPointSchema).max(24),
    accountFreshness: z.array(homeAccountFreshnessSchema).max(100),
    isEmpty: z.boolean(),
  })
  .strict();

export const homeOverviewResponseSchema = z
  .object({
    data: homeOverviewDataSchema,
    meta: canonicalMetaSchema
      .extend({
        calculationVersion: z.literal('home-overview-1'),
        completeness: completenessSchema,
        estimated: z.boolean(),
        missingSections: z.array(z.enum(['availableMoney', 'budget', 'netWorth', 'categories', 'cashFlow', 'accountFreshness'])).max(6),
      })
      .strict(),
  })
  .strict();

export type HomeOverviewData = z.infer<typeof homeOverviewDataSchema>;
export type HomeOverviewResponse = z.infer<typeof homeOverviewResponseSchema>;

export const canonicalErrorCodeSchema = z.enum([
  'authentication_required',
  'authentication_invalid',
  'mac_only',
  'pairing_required',
  'validation_error',
  'resource_not_found',
  'resource_conflict',
  'idempotency_key_required',
  'idempotency_key_reused',
  'unknown_outcome',
  'route_not_found',
  'internal_server_error',
]);

export type CanonicalErrorCode = z.infer<typeof canonicalErrorCodeSchema>;

export const canonicalErrorDefinitionSchema = z
  .object({
    statusCode: z.number().int().min(400).max(599),
    message: z.string().trim().min(1),
  })
  .strict();

export const CANONICAL_ERROR_DEFINITIONS: Record<
  CanonicalErrorCode,
  z.infer<typeof canonicalErrorDefinitionSchema>
> = {
  authentication_required: { statusCode: 401, message: 'Authentication is required.' },
  authentication_invalid: { statusCode: 401, message: 'The caller credential is invalid.' },
  mac_only: { statusCode: 403, message: 'This operation is available only on the Mac.' },
  pairing_required: { statusCode: 403, message: 'This operation requires a paired iPhone.' },
  validation_error: { statusCode: 400, message: 'The request contains invalid data.' },
  resource_not_found: { statusCode: 404, message: 'The requested resource was not found.' },
  resource_conflict: {
    statusCode: 409,
    message: 'The resource changed before this request was applied.',
  },
  idempotency_key_required: { statusCode: 400, message: 'An idempotency key is required.' },
  idempotency_key_reused: {
    statusCode: 409,
    message: 'The idempotency key was used for a different request.',
  },
  unknown_outcome: {
    statusCode: 503,
    message: 'The command outcome is unknown. Retry with the same idempotency key.',
  },
  route_not_found: { statusCode: 404, message: 'The requested route does not exist.' },
  internal_server_error: { statusCode: 500, message: 'An unexpected error occurred.' },
};

export const canonicalErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: canonicalErrorCodeSchema,
        message: z.string().trim().min(1),
        resourceId: entityIdSchema.optional(),
        expectedVersion: resourceVersionSchema.optional(),
        currentVersion: resourceVersionSchema.optional(),
      })
      .strict(),
    meta: z
      .object({
        apiVersion: z.literal(CANONICAL_API_VERSION),
        requestId: z.string().trim().min(1).max(128),
        refreshHints: z.array(refreshHintSchema).max(20).optional(),
      })
      .strict(),
  })
  .strict();

export const referenceResourceSchema = z
  .object({
    id: entityIdSchema,
    title: z.string().trim().min(1).max(120),
    amount: moneySchema,
    resourceVersion: resourceVersionSchema,
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const referenceResponseSchema = z
  .object({
    data: referenceResourceSchema,
    meta: canonicalMetaSchema.extend({
      calculationVersion: z.literal('canonical-foundation-1'),
      completeness: z.literal('complete'),
      estimated: z.literal(false),
    }),
  })
  .strict();

export const referenceReadQuerySchema = z
  .object({ id: z.coerce.number().int().positive().optional() })
  .strict();

export const referenceUpdateRequestSchema = z
  .object({
    expectedVersion: resourceVersionSchema,
    title: z.string().trim().min(1).max(120).optional(),
    amount: moneySchema.optional(),
  })
  .strict()
  .refine((value) => value.title !== undefined || value.amount !== undefined, {
    message: 'At least one editable field is required',
  });

export const referenceDeleteQuerySchema = z
  .object({ expectedVersion: z.coerce.number().int().min(1) })
  .strict();

export const referenceDeleteResponseSchema = z
  .object({
    data: z
      .object({
        deletedId: entityIdSchema,
      })
      .strict(),
    meta: canonicalMetaSchema.extend({
      refreshHints: z.array(refreshHintSchema).min(1),
    }),
  })
  .strict();

export const referenceCommandRequestSchema = z
  .object({
    resourceId: entityIdSchema,
    idempotencyKey: z.string().trim().min(1).max(128),
    command: z.literal('refresh'),
  })
  .strict();

export const referenceCommandResponseSchema = z
  .object({
    data: z
      .object({
        accepted: z.literal(true),
        resourceId: entityIdSchema,
      })
      .strict(),
    meta: canonicalMetaSchema.extend({
      receipt: mutationReceiptSchema,
      refreshHints: z.array(refreshHintSchema).min(1),
    }),
  })
  .strict();

export const diagnosticsResponseSchema = z
  .object({
    data: z
      .object({
        listener: z.literal('mac-local'),
        capabilities: z.array(z.literal('canonical-api')).length(1),
      })
      .strict(),
    meta: canonicalMetaSchema,
  })
  .strict();

export const pairingStatusResponseSchema = z
  .object({
    data: z
      .object({
        paired: z.literal(true),
        deviceId: z.string().trim().min(1).max(128),
      })
      .strict(),
    meta: canonicalMetaSchema,
  })
  .strict();

export type Money = z.infer<typeof moneySchema>;
export type ReferenceResource = z.infer<typeof referenceResourceSchema>;
export type CanonicalMeta = z.infer<typeof canonicalMetaSchema>;
export type CanonicalErrorEnvelope = z.infer<typeof canonicalErrorEnvelopeSchema>;
export type ReferenceUpdateRequest = z.infer<typeof referenceUpdateRequestSchema>;
export type ReferenceCommandRequest = z.infer<typeof referenceCommandRequestSchema>;
export type ReferenceCommandResponse = z.infer<typeof referenceCommandResponseSchema>;

export function successEnvelopeSchema<T extends z.ZodType>(data: T) {
  return z.object({ data, meta: canonicalMetaSchema }).strict();
}

export function createCanonicalMeta(
  generatedAt: Date,
  extra: Partial<Omit<CanonicalMeta, 'apiVersion' | 'generatedAt' | 'source'>> = {},
): CanonicalMeta {
  return {
    apiVersion: CANONICAL_API_VERSION,
    generatedAt: generatedAt.toISOString(),
    source: CANONICAL_GENERATED_SOURCE,
    ...extra,
  };
}

export function isCanonicalMoney(value: unknown): value is Money {
  return moneySchema.safeParse(value).success;
}
