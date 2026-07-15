import { z } from 'zod';
import {
  MOBILE_API_VERSION,
  MOBILE_ERROR_DEFINITIONS,
  MOBILE_PROTOCOL_VERSION,
  MOBILE_RESPONSE_SOURCE,
} from './contract.js';

export const BOOTSTRAP_SCHEMA_VERSION = 1 as const;
export const MOBILE_FINANCE_TIME_ZONE = 'Asia/Jerusalem' as const;

const DECIMAL_MONEY_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;
const FINANCIAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UTC_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const OPAQUE_ID_PATTERN = /^(?!\d+$)[A-Za-z0-9_-]{8,128}$/;
const SEMANTIC_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const MASKED_IDENTIFIER_PATTERN = /^(?:••••|\*{4}) [A-Za-z0-9]{2,4}$/;
const ISO_CURRENCY_CODES = new Set(Intl.supportedValuesOf('currency'));

function isValidFinancialDate(value: string): boolean {
  if (!FINANCIAL_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidUtcInstant(value: string): boolean {
  if (!UTC_INSTANT_PATTERN.test(value)) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const normalized = new Date(timestamp).toISOString();
  return normalized === value || normalized === value.replace('Z', '.000Z');
}

function instantIsAfter(candidate: string, ceiling: string): boolean {
  return Date.parse(candidate) > Date.parse(ceiling);
}

/** Resolves the local finance day without depending on the host's time zone. */
export function mobileFinancialDateFor(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MOBILE_FINANCE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export const bootstrapFinancialDateSchema = z
  .string()
  .regex(FINANCIAL_DATE_PATTERN, 'Expected a YYYY-MM-DD financial date')
  .refine(isValidFinancialDate, 'Expected a valid YYYY-MM-DD financial date');

export const bootstrapInstantSchema = z
  .string()
  .regex(UTC_INSTANT_PATTERN, 'Expected an ISO 8601 UTC instant')
  .refine(isValidUtcInstant, 'Expected a valid ISO 8601 UTC instant');

export const bootstrapCurrencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .refine((value) => ISO_CURRENCY_CODES.has(value), 'Expected an ISO 4217 currency code');

export const bootstrapOpaqueIdSchema = z.string().regex(OPAQUE_ID_PATTERN);

export const bootstrapMoneySchema = z.object({
  value: z.string().regex(DECIMAL_MONEY_PATTERN),
  currencyCode: bootstrapCurrencyCodeSchema,
});

export const bootstrapPeriodSchema = z
  .object({
    startDate: bootstrapFinancialDateSchema,
    endDate: bootstrapFinancialDateSchema,
  })
  .superRefine((period, context) => {
    if (period.startDate > period.endDate) {
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'Period end date cannot precede its start date',
      });
    }
  });

export const bootstrapMonetaryAggregateSchema = z
  .object({
    amount: bootstrapMoneySchema,
    period: bootstrapPeriodSchema,
    comparisonPeriod: bootstrapPeriodSchema.nullable(),
    calculatedAt: bootstrapInstantSchema,
  })
  .superRefine((aggregate, context) => {
    if (
      aggregate.comparisonPeriod &&
      aggregate.comparisonPeriod.endDate >= aggregate.period.startDate
    ) {
      context.addIssue({
        code: 'custom',
        path: ['comparisonPeriod'],
        message: 'Comparison period must finish before the primary period',
      });
    }
  });

export const bootstrapCapabilitySchema = z.enum(['mobile.read', 'unknown']);
export const bootstrapCompatibilityStatusSchema = z.enum(['compatible', 'not_evaluated']);
export const bootstrapCompatibilityReasonSchema = z.enum([
  'client_version_too_old',
  'protocol_unsupported',
  'schema_unsupported',
]);
export const bootstrapCacheabilityStatusSchema = z.enum(['cacheable', 'not_cacheable']);
export const bootstrapCompletenessStatusSchema = z.enum(['complete', 'partial']);
export const bootstrapSectionSchema = z.enum([
  'home',
  'budget_pulse',
  'review',
  'recent_transactions',
  'accounts',
  'latest_sync',
]);
export const bootstrapSectionErrorCodeSchema = z.enum([
  'source_unavailable',
  'source_timeout',
  'calculation_failed',
  'unknown',
]);

export const bootstrapServerSchema = z
  .object({
    id: z.string().uuid(),
    displayName: z.string().trim().min(1).max(80),
    serverVersion: z.string().regex(SEMANTIC_VERSION_PATTERN),
    protocolVersion: z.literal(MOBILE_PROTOCOL_VERSION),
    minimumClientVersion: z.string().regex(SEMANTIC_VERSION_PATTERN),
    capabilities: z
      .array(bootstrapCapabilitySchema)
      .min(1)
      .refine((capabilities) => new Set(capabilities).size === capabilities.length),
    compatibility: z.object({
      status: bootstrapCompatibilityStatusSchema,
      reason: z.null(),
    }),
  })
  .superRefine((server, context) => {
    if (!server.capabilities.includes('mobile.read')) {
      context.addIssue({
        code: 'custom',
        path: ['capabilities'],
        message: 'A successful bootstrap requires mobile.read capability',
      });
    }
  });

export const bootstrapSectionErrorSchema = z.object({
  section: bootstrapSectionSchema,
  code: bootstrapSectionErrorCodeSchema,
  retryable: z.boolean(),
});

export const bootstrapMetaSchema = z
  .object({
    apiVersion: z.literal(MOBILE_API_VERSION),
    generatedAt: bootstrapInstantSchema,
    calculatedAt: bootstrapInstantSchema,
    financialDate: bootstrapFinancialDateSchema,
    source: z.literal(MOBILE_RESPONSE_SOURCE),
    bootstrapSchemaVersion: z.literal(BOOTSTRAP_SCHEMA_VERSION),
    snapshotId: bootstrapOpaqueIdSchema,
    server: bootstrapServerSchema,
    cacheability: z.object({
      status: bootstrapCacheabilityStatusSchema,
      maxAgeSeconds: z.number().int().nonnegative(),
    }),
    completeness: z.object({
      status: bootstrapCompletenessStatusSchema,
      sectionErrors: z
        .array(bootstrapSectionErrorSchema)
        .max(bootstrapSectionSchema.options.length),
    }),
  })
  .superRefine((meta, context) => {
    const sections = meta.completeness.sectionErrors.map((error) => error.section);
    if (new Set(sections).size !== sections.length) {
      context.addIssue({
        code: 'custom',
        path: ['completeness', 'sectionErrors'],
        message: 'A partial snapshot can report each section at most once',
      });
    }
    if (instantIsAfter(meta.calculatedAt, meta.generatedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['calculatedAt'],
        message: 'Snapshot calculation cannot be newer than serialization',
      });
    }
    if (meta.financialDate !== mobileFinancialDateFor(new Date(meta.calculatedAt))) {
      context.addIssue({
        code: 'custom',
        path: ['financialDate'],
        message: 'Financial date must match the calculation instant in Asia/Jerusalem',
      });
    }
  });

export const bootstrapUpgradeRequiredEnvelopeSchema = z.object({
  error: z.object({
    code: z.literal('upgrade_required'),
    message: z.literal(MOBILE_ERROR_DEFINITIONS.upgrade_required.message),
  }),
  meta: z.object({
    apiVersion: z.literal(MOBILE_API_VERSION),
    requestId: z.string().trim().min(1).max(128),
  }),
});

export type BootstrapUpgradeRequiredEnvelope = z.infer<
  typeof bootstrapUpgradeRequiredEnvelopeSchema
>;

export const bootstrapHomeSchema = z
  .object({
    primaryCurrencyCode: bootstrapCurrencyCodeSchema,
    aggregates: z.object({
      netWorth: bootstrapMonetaryAggregateSchema,
      income: bootstrapMonetaryAggregateSchema,
      spending: bootstrapMonetaryAggregateSchema,
    }),
  })
  .superRefine((home, context) => {
    for (const [name, aggregate] of Object.entries(home.aggregates)) {
      if (aggregate.amount.currencyCode !== home.primaryCurrencyCode) {
        context.addIssue({
          code: 'custom',
          path: ['aggregates', name, 'amount', 'currencyCode'],
          message: 'Home aggregates must use the declared primary currency',
        });
      }
    }
  });

export const bootstrapBudgetStatusSchema = z.enum([
  'on_track',
  'watch',
  'over_budget',
  'unavailable',
  'unknown',
]);

export const bootstrapBudgetPulseSchema = z
  .object({
    status: bootstrapBudgetStatusSchema,
    spent: bootstrapMoneySchema.nullable(),
    limit: bootstrapMoneySchema.nullable(),
    remaining: bootstrapMoneySchema.nullable(),
    period: bootstrapPeriodSchema,
    calculatedAt: bootstrapInstantSchema,
  })
  .superRefine((pulse, context) => {
    const amounts = [pulse.spent, pulse.limit, pulse.remaining];
    if (pulse.status === 'unavailable') {
      if (amounts.some((amount) => amount !== null)) {
        context.addIssue({
          code: 'custom',
          path: ['status'],
          message: 'Unavailable budget pulse cannot contain monetary amounts',
        });
      }
      return;
    }

    if (amounts.some((amount) => amount === null)) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Available budget pulse requires spent, limit, and remaining amounts',
      });
      return;
    }

    const currencies = new Set(amounts.map((amount) => amount?.currencyCode));
    if (currencies.size !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['spent'],
        message: 'Budget pulse amounts must use one currency',
      });
    }
  });

export const bootstrapReviewSchema = z.object({
  count: z.number().int().nonnegative(),
  calculatedAt: bootstrapInstantSchema,
});

export const bootstrapTransactionStatusSchema = z.enum(['posted', 'pending', 'unknown']);
export const bootstrapTransactionDirectionSchema = z.enum(['debit', 'credit', 'unknown']);

export const bootstrapRecentTransactionSchema = z.object({
  id: bootstrapOpaqueIdSchema,
  occurredOn: bootstrapFinancialDateSchema,
  displayName: z.string().trim().min(1).max(160),
  amount: bootstrapMoneySchema,
  direction: bootstrapTransactionDirectionSchema,
  status: bootstrapTransactionStatusSchema,
  category: z
    .object({
      id: bootstrapOpaqueIdSchema,
      label: z.string().trim().min(1).max(80),
    })
    .nullable(),
  account: z.object({
    id: bootstrapOpaqueIdSchema,
    displayName: z.string().trim().min(1).max(80),
    identifierMask: z.string().regex(MASKED_IDENTIFIER_PATTERN),
  }),
});

export const bootstrapAccountTypeSchema = z.enum([
  'checking',
  'savings',
  'credit_card',
  'investment',
  'loan',
  'other',
  'unknown',
]);
export const bootstrapFreshnessStatusSchema = z.enum([
  'fresh',
  'stale',
  'never_synced',
  'error',
  'unknown',
]);

export const bootstrapAccountFreshnessSchema = z
  .object({
    id: bootstrapOpaqueIdSchema,
    displayName: z.string().trim().min(1).max(80),
    institutionName: z.string().trim().min(1).max(80),
    type: bootstrapAccountTypeSchema,
    currencyCode: bootstrapCurrencyCodeSchema,
    identifierMask: z.string().regex(MASKED_IDENTIFIER_PATTERN),
    freshness: z.object({
      status: bootstrapFreshnessStatusSchema,
      lastSuccessfulSyncAt: bootstrapInstantSchema.nullable(),
    }),
  })
  .superRefine((account, context) => {
    if (
      (account.freshness.status === 'fresh' || account.freshness.status === 'stale') &&
      account.freshness.lastSuccessfulSyncAt === null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['freshness', 'lastSuccessfulSyncAt'],
        message: 'Fresh and stale accounts require their latest successful sync time',
      });
    }
    if (
      account.freshness.status === 'never_synced' &&
      account.freshness.lastSuccessfulSyncAt !== null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['freshness', 'lastSuccessfulSyncAt'],
        message: 'A never-synced account cannot have a successful sync time',
      });
    }
  });

export const bootstrapSyncStatusSchema = z.enum([
  'succeeded',
  'partial',
  'failed',
  'never_run',
  'unknown',
]);

export const bootstrapLatestSyncSchema = z
  .object({
    status: bootstrapSyncStatusSchema,
    startedAt: bootstrapInstantSchema.nullable(),
    completedAt: bootstrapInstantSchema.nullable(),
    accountsSucceeded: z.number().int().nonnegative(),
    accountsFailed: z.number().int().nonnegative(),
  })
  .superRefine((sync, context) => {
    if (sync.status === 'never_run') {
      if (
        sync.startedAt !== null ||
        sync.completedAt !== null ||
        sync.accountsSucceeded !== 0 ||
        sync.accountsFailed !== 0
      ) {
        context.addIssue({
          code: 'custom',
          path: ['status'],
          message: 'Never-run sync summary cannot contain run details',
        });
      }
      return;
    }

    if (sync.startedAt === null || sync.completedAt === null) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'Completed sync states require start and completion instants',
      });
      return;
    }
    if (Date.parse(sync.startedAt) > Date.parse(sync.completedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'Sync completion cannot precede its start',
      });
    }
    if (sync.status === 'succeeded' && sync.accountsFailed !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['accountsFailed'],
        message: 'Successful sync cannot report failed accounts',
      });
    }
    if ((sync.status === 'partial' || sync.status === 'failed') && sync.accountsFailed === 0) {
      context.addIssue({
        code: 'custom',
        path: ['accountsFailed'],
        message: 'Partial and failed sync states must report at least one failed account',
      });
    }
  });

export const bootstrapDataSchema = z.object({
  home: bootstrapHomeSchema,
  budgetPulse: bootstrapBudgetPulseSchema,
  review: bootstrapReviewSchema,
  recentTransactions: z.array(bootstrapRecentTransactionSchema).max(20),
  accounts: z.array(bootstrapAccountFreshnessSchema),
  latestSync: bootstrapLatestSyncSchema,
});

export const bootstrapSuccessEnvelopeSchema = z
  .object({
    data: bootstrapDataSchema,
    meta: bootstrapMetaSchema,
  })
  .superRefine((envelope, context) => {
    const { generatedAt, calculatedAt, financialDate, cacheability, completeness } = envelope.meta;

    if (cacheability.status === 'cacheable' && cacheability.maxAgeSeconds === 0) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'cacheability', 'maxAgeSeconds'],
        message: 'Cacheable snapshots require a positive maximum age',
      });
    }
    if (cacheability.status === 'not_cacheable' && cacheability.maxAgeSeconds !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'cacheability', 'maxAgeSeconds'],
        message: 'Non-cacheable snapshots must use zero maximum age',
      });
    }
    if (completeness.status === 'complete' && completeness.sectionErrors.length !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'completeness', 'sectionErrors'],
        message: 'Complete snapshots cannot contain section errors',
      });
    }
    if (completeness.status === 'partial') {
      if (completeness.sectionErrors.length === 0) {
        context.addIssue({
          code: 'custom',
          path: ['meta', 'completeness', 'sectionErrors'],
          message: 'Partial snapshots require at least one safe section error',
        });
      }
      if (cacheability.status !== 'not_cacheable') {
        context.addIssue({
          code: 'custom',
          path: ['meta', 'cacheability', 'status'],
          message: 'Partial snapshots cannot replace the cache',
        });
      }
    }
    for (const sectionError of completeness.sectionErrors) {
      if (
        sectionError.section === 'budget_pulse' &&
        envelope.data.budgetPulse.status !== 'unavailable'
      ) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'budgetPulse', 'status'],
          message: 'A failed budget section must use the unavailable representation',
        });
      }
    }

    for (const [name, aggregate] of Object.entries(envelope.data.home.aggregates)) {
      if (aggregate.calculatedAt !== calculatedAt) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'home', 'aggregates', name, 'calculatedAt'],
          message: 'Aggregate calculation must match the coherent snapshot calculation point',
        });
      }
      if (aggregate.period.endDate > financialDate) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'home', 'aggregates', name, 'period', 'endDate'],
          message: 'Aggregate period cannot end after the snapshot financial date',
        });
      }
    }

    if (envelope.data.budgetPulse.calculatedAt !== calculatedAt) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'budgetPulse', 'calculatedAt'],
        message: 'Budget calculation must match the coherent snapshot calculation point',
      });
    }
    if (envelope.data.budgetPulse.period.endDate > financialDate) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'budgetPulse', 'period', 'endDate'],
        message: 'Budget period cannot end after the snapshot financial date',
      });
    }
    if (envelope.data.review.calculatedAt !== calculatedAt) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'review', 'calculatedAt'],
        message: 'Review calculation must match the coherent snapshot calculation point',
      });
    }

    envelope.data.recentTransactions.forEach((transaction, index) => {
      if (transaction.occurredOn > financialDate) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'recentTransactions', index, 'occurredOn'],
          message: 'Transaction date cannot be newer than the snapshot financial date',
        });
      }
    });
    envelope.data.accounts.forEach((account, index) => {
      const lastSync = account.freshness.lastSuccessfulSyncAt;
      if (lastSync && instantIsAfter(lastSync, generatedAt)) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'accounts', index, 'freshness', 'lastSuccessfulSyncAt'],
          message: 'Account freshness cannot be newer than its snapshot',
        });
      }
    });
    const completedAt = envelope.data.latestSync.completedAt;
    if (completedAt && instantIsAfter(completedAt, generatedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'latestSync', 'completedAt'],
        message: 'Latest sync cannot complete after snapshot generation',
      });
    }
  });

export type BootstrapSuccessEnvelope = z.infer<typeof bootstrapSuccessEnvelopeSchema>;

export const bootstrapRedactionViolationCodeSchema = z.enum([
  'forbidden_key',
  'forbidden_sentinel_value',
  'credential_like_value',
  'token_like_value',
  'hash_like_value',
  'account_identifier_like_value',
  'floating_number',
]);

export type BootstrapRedactionViolationCode = z.infer<typeof bootstrapRedactionViolationCodeSchema>;

export interface BootstrapRedactionViolation {
  code: BootstrapRedactionViolationCode;
  path: string;
}

const FORBIDDEN_KEY_PATTERN =
  /credential|token|hash|digest|rawrow|databaserow|fullaccountnumber|accountnumber|routingnumber|iban|cardpan/;
const FORBIDDEN_SENTINEL_PATTERN = /(?:forbidden|secret)[_-]?sentinel/i;
const CREDENTIAL_VALUE_PATTERN = /^(?:Bearer\s+|keychain:\/\/|credential:\/\/)/i;
const SECRET_PREFIX_VALUE_PATTERN =
  /^(?:sk|pk|rk|ghp|github_pat|xox[baprs]|AIza)[-_][A-Za-z0-9_-]{8,}$/i;
const TOKEN_VALUE_PATTERN =
  /^(?:[A-Za-z0-9_-]{43}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const HASH_VALUE_PATTERN = /^[a-fA-F0-9]{64}$/;

function normalizedKey(key: string): string {
  return key.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function containsLongFinancialIdentifier(value: string): boolean {
  return (value.match(/[\d -]{12,32}/g) ?? []).some((candidate) => {
    const digits = candidate.replace(/\D/g, '');
    return digits.length >= 12 && digits.length <= 19;
  });
}

export function findBootstrapRedactionViolations(input: unknown): BootstrapRedactionViolation[] {
  const violations: BootstrapRedactionViolation[] = [];
  const seen = new WeakSet<object>();

  function visit(value: unknown, path: string): void {
    if (typeof value === 'number' && !Number.isInteger(value)) {
      violations.push({ code: 'floating_number', path });
      return;
    }
    if (typeof value === 'string') {
      if (FORBIDDEN_SENTINEL_PATTERN.test(value)) {
        violations.push({ code: 'forbidden_sentinel_value', path });
      } else if (CREDENTIAL_VALUE_PATTERN.test(value) || SECRET_PREFIX_VALUE_PATTERN.test(value)) {
        violations.push({ code: 'credential_like_value', path });
      } else if (TOKEN_VALUE_PATTERN.test(value)) {
        violations.push({ code: 'token_like_value', path });
      } else if (HASH_VALUE_PATTERN.test(value)) {
        violations.push({ code: 'hash_like_value', path });
      } else if (containsLongFinancialIdentifier(value)) {
        violations.push({ code: 'account_identifier_like_value', path });
      }
      return;
    }
    if (value === null || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (FORBIDDEN_KEY_PATTERN.test(normalizedKey(key))) {
        violations.push({ code: 'forbidden_key', path: childPath });
      }
      visit(child, childPath);
    }
  }

  visit(input, '$');
  return violations;
}

export type BootstrapValidationIssueCode = BootstrapRedactionViolationCode | 'schema_invalid';

export interface BootstrapValidationIssue {
  code: BootstrapValidationIssueCode;
  path: string;
}

export type BootstrapValidationResult =
  | { success: true; data: BootstrapSuccessEnvelope }
  | { success: false; issues: BootstrapValidationIssue[] };

/** Validates the raw object before Zod can strip benign future fields. */
export function validateBootstrapPayload(input: unknown): BootstrapValidationResult {
  const redactionViolations = findBootstrapRedactionViolations(input);
  if (redactionViolations.length > 0) {
    return { success: false, issues: redactionViolations };
  }

  const parsed = bootstrapSuccessEnvelopeSchema.safeParse(input);
  if (parsed.success) return { success: true, data: parsed.data };

  return {
    success: false,
    issues: parsed.error.issues.map((issue) => ({
      code: 'schema_invalid',
      path: issue.path.length > 0 ? `$.${issue.path.map(String).join('.')}` : '$',
    })),
  };
}
