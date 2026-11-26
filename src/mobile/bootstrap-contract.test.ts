import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bootstrapUpgradeRequiredEnvelopeSchema,
  findBootstrapRedactionViolations,
  mobileFinancialDateFor,
  validateBootstrapPayload,
  type BootstrapSuccessEnvelope,
} from './bootstrap-contract.js';

const FIXTURE_DIRECTORY = join(process.cwd(), 'src', 'mobile', 'fixtures', 'bootstrap');
const ACCEPTED_FIXTURES = [
  'bootstrap-complete.json',
  'bootstrap-empty.json',
  'bootstrap-mixed-currency.json',
  'bootstrap-mixed-hebrew.json',
  'bootstrap-partial-error.json',
] as const;
const INCOMPATIBLE_FIXTURE = 'bootstrap-incompatible.json';
const REJECTED_FIXTURE = 'bootstrap-forbidden-redaction.json';

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIRECTORY, name), 'utf8')) as unknown;
}

function acceptedFixture(name: (typeof ACCEPTED_FIXTURES)[number]): BootstrapSuccessEnvelope {
  const result = validateBootstrapPayload(loadFixture(name));
  if (!result.success) {
    throw new Error(`Expected ${name} to validate: ${JSON.stringify(result.issues)}`);
  }
  return result.data;
}

function expectSchemaRejection(value: unknown): void {
  const result = validateBootstrapPayload(value);
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.issues.every((issue) => issue.code === 'schema_invalid')).toBe(true);
  }
}

describe('mobile bootstrap canonical fixtures', () => {
  it.each(ACCEPTED_FIXTURES)('validates %s without redaction violations', (name) => {
    const raw = loadFixture(name);
    expect(findBootstrapRedactionViolations(raw)).toEqual([]);
    expect(validateBootstrapPayload(raw).success).toBe(true);
  });

  it('represents incompatibility as a 426 error envelope without feature data', () => {
    const raw = loadFixture(INCOMPATIBLE_FIXTURE);
    const fixture = bootstrapUpgradeRequiredEnvelopeSchema.parse(raw);

    expect(findBootstrapRedactionViolations(raw)).toEqual([]);
    expect(fixture.error.code).toBe('upgrade_required');
    expect(fixture.meta.apiVersion).toBe('1');
    expect('data' in fixture).toBe(false);
    expect(validateBootstrapPayload(raw).success).toBe(false);
  });
});

describe('mobile bootstrap redaction boundary', () => {
  it('rejects the sentinel fixture before unknown fields can be stripped by Zod', () => {
    const result = validateBootstrapPayload(loadFixture(REJECTED_FIXTURE));
    expect(result.success).toBe(false);
    if (result.success) return;

    const codes = new Set(result.issues.map((issue) => issue.code));
    expect(codes).toEqual(
      new Set([
        'forbidden_key',
        'forbidden_sentinel_value',
        'token_like_value',
        'hash_like_value',
        'account_identifier_like_value',
        'floating_number',
      ]),
    );
    expect(result.issues.every((issue) => !('value' in issue))).toBe(true);
  });

  it('does not misclassify random UUIDs with 12-digit segments as account numbers', () => {
    const envelope = acceptedFixture('bootstrap-complete.json');
    envelope.meta.snapshotId = 'c3c524a4-af29-4b03-a5f4-556950174389';
    envelope.meta.server.id = 'a1b2c3d4-1234-4567-8901-234567890abc';
    expect(findBootstrapRedactionViolations(envelope)).toEqual([]);
    expect(validateBootstrapPayload(envelope).success).toBe(true);
  });

  it('recursively rejects credential, token, hash, raw-row, and account-number keys', () => {
    const input = {
      outer: [
        {
          bankCredential: 'redacted',
          device_token: 'redacted',
          nested: { sha256Hash: 'redacted', rawRow: { accountNumber: 'redacted' } },
        },
      ],
    };

    const violations = findBootstrapRedactionViolations(input);
    expect(violations).toHaveLength(5);
    expect(violations.every((violation) => violation.code === 'forbidden_key')).toBe(true);
  });

  it('recursively rejects credential-, token-, hash-, sentinel-, and float-like values', () => {
    const violations = findBootstrapRedactionViolations({
      values: [
        'Bearer hidden-value',
        'sk-ant-api03-exampleSecretValue',
        'A'.repeat(43),
        'a'.repeat(64),
        'FORBIDDEN_SECRET_SENTINEL',
        'Visa 4111111111111111',
        10.25,
      ],
    });

    expect(violations.map((violation) => violation.code)).toEqual([
      'credential_like_value',
      'credential_like_value',
      'token_like_value',
      'hash_like_value',
      'forbidden_sentinel_value',
      'account_identifier_like_value',
      'floating_number',
    ]);
  });

  it('rejects made-up currency codes even when they have three uppercase letters', () => {
    const fixture = structuredClone(acceptedFixture('bootstrap-complete.json'));
    fixture.data.home.primaryCurrencyCode = 'ZZZ';
    fixture.data.home.aggregates.netWorth.amount.currencyCode = 'ZZZ';
    fixture.data.home.aggregates.income.amount.currencyCode = 'ZZZ';
    fixture.data.home.aggregates.spending.amount.currencyCode = 'ZZZ';

    expectSchemaRejection(fixture);
  });
});

describe('mobile bootstrap version and time invariants', () => {
  it.each([
    ['summer', '2026-07-14T21:30:00.000Z', '2026-07-15'],
    ['winter', '2026-12-14T22:30:00.000Z', '2026-12-15'],
  ])(
    'resolves the Asia/Jerusalem finance date across UTC midnight in %s',
    (_season, instant, date) => {
      expect(mobileFinancialDateFor(new Date(instant))).toBe(date);
    },
  );

  it('requires an explicit finance date matching the calculation instant', () => {
    const missing = structuredClone(acceptedFixture('bootstrap-complete.json')) as unknown as {
      meta: Record<string, unknown>;
    };
    delete missing.meta.financialDate;
    expectSchemaRejection(missing);

    const mismatched = structuredClone(acceptedFixture('bootstrap-complete.json'));
    mismatched.meta.financialDate = '2026-07-14';
    expectSchemaRejection(mismatched);
  });

  it('allows benign future optional fields but rejects unknown required schema versions', () => {
    const futureCompatible = structuredClone(acceptedFixture('bootstrap-complete.json'));
    const openEnvelope = futureCompatible as unknown as Record<string, unknown>;
    const openMeta = futureCompatible.meta as unknown as Record<string, unknown>;
    const openData = futureCompatible.data as unknown as Record<string, unknown>;
    openEnvelope.futureEnvelopeField = { enabled: true };
    openMeta.futureMetaField = 'safe';
    openData.futureSection = [];

    expect(validateBootstrapPayload(futureCompatible).success).toBe(true);

    const unsupportedSchema = structuredClone(acceptedFixture('bootstrap-complete.json'));
    (unsupportedSchema.meta as { bootstrapSchemaVersion: number }).bootstrapSchemaVersion = 2;
    expectSchemaRejection(unsupportedSchema);

    const unsupportedApi = structuredClone(acceptedFixture('bootstrap-complete.json'));
    (unsupportedApi.meta as { apiVersion: string }).apiVersion = '2';
    expectSchemaRejection(unsupportedApi);
  });

  it('rejects reversed and overlapping aggregate periods', () => {
    const reversed = structuredClone(acceptedFixture('bootstrap-complete.json'));
    reversed.data.home.aggregates.income.period = {
      startDate: '2026-07-15',
      endDate: '2026-07-01',
    };
    expectSchemaRejection(reversed);

    const overlapping = structuredClone(acceptedFixture('bootstrap-complete.json'));
    overlapping.data.home.aggregates.spending.comparisonPeriod = {
      startDate: '2026-07-01',
      endDate: '2026-07-10',
    };
    expectSchemaRejection(overlapping);
  });

  it('uses the finance date for business dates and generatedAt for instants', () => {
    const aggregate = structuredClone(acceptedFixture('bootstrap-complete.json'));
    aggregate.data.home.aggregates.netWorth.calculatedAt = '2026-07-15T10:00:01.000Z';
    expectSchemaRejection(aggregate);

    const transaction = structuredClone(acceptedFixture('bootstrap-complete.json'));
    transaction.data.recentTransactions[0].occurredOn = '2026-07-16';
    expectSchemaRejection(transaction);

    const JerusalemMidnight = structuredClone(acceptedFixture('bootstrap-empty.json'));
    JerusalemMidnight.meta.calculatedAt = '2026-07-14T21:30:00.000Z';
    JerusalemMidnight.meta.generatedAt = '2026-07-14T21:30:01.000Z';
    JerusalemMidnight.meta.financialDate = '2026-07-15';
    JerusalemMidnight.data.home.aggregates.netWorth.calculatedAt =
      JerusalemMidnight.meta.calculatedAt;
    JerusalemMidnight.data.home.aggregates.income.calculatedAt =
      JerusalemMidnight.meta.calculatedAt;
    JerusalemMidnight.data.home.aggregates.spending.calculatedAt =
      JerusalemMidnight.meta.calculatedAt;
    JerusalemMidnight.data.budgetPulse.calculatedAt = JerusalemMidnight.meta.calculatedAt;
    JerusalemMidnight.data.review.calculatedAt = JerusalemMidnight.meta.calculatedAt;
    expect(validateBootstrapPayload(JerusalemMidnight).success).toBe(true);

    const freshness = structuredClone(acceptedFixture('bootstrap-complete.json'));
    freshness.data.accounts[0].freshness.lastSuccessfulSyncAt = '2026-07-15T10:00:01.000Z';
    expectSchemaRejection(freshness);

    const sync = structuredClone(acceptedFixture('bootstrap-complete.json'));
    sync.data.latestSync.completedAt = '2026-07-15T10:00:01.000Z';
    expectSchemaRejection(sync);
  });

  it('requires the current protocol, stable UUID identity, and mobile.read capability', () => {
    const protocol = structuredClone(acceptedFixture('bootstrap-complete.json'));
    (protocol.meta.server as { protocolVersion: number }).protocolVersion = 999;
    expectSchemaRejection(protocol);

    const identity = structuredClone(acceptedFixture('bootstrap-complete.json'));
    identity.meta.server.id = 'server_database_row_1';
    expectSchemaRejection(identity);

    const capability = structuredClone(acceptedFixture('bootstrap-complete.json'));
    capability.meta.server.capabilities = ['unknown'];
    expectSchemaRejection(capability);
  });

  it('rejects duplicate section errors and contradictory failed budget data', () => {
    const duplicate = structuredClone(acceptedFixture('bootstrap-partial-error.json'));
    duplicate.meta.completeness.sectionErrors.push({
      section: 'budget_pulse',
      code: 'source_timeout',
      retryable: true,
    });
    expectSchemaRejection(duplicate);

    const contradiction = structuredClone(acceptedFixture('bootstrap-complete.json'));
    contradiction.meta.cacheability = { status: 'not_cacheable', maxAgeSeconds: 0 };
    contradiction.meta.completeness = {
      status: 'partial',
      sectionErrors: [{ section: 'budget_pulse', code: 'calculation_failed', retryable: false }],
    };
    expectSchemaRejection(contradiction);
  });

  it('rejects partial snapshots that claim cacheability', () => {
    const partial = structuredClone(acceptedFixture('bootstrap-partial-error.json'));
    partial.meta.cacheability = { status: 'cacheable', maxAgeSeconds: 300 };
    expectSchemaRejection(partial);
  });
});
