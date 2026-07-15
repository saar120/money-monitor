import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bootstrapUpgradeRequiredEnvelopeSchema,
  findBootstrapRedactionViolations,
  mobileFinancialDateFor,
  validateBootstrapPayload,
  type BootstrapSuccessEnvelope,
} from './bootstrap-contract.js';

const FIXTURE_DIRECTORY = join(process.cwd(), 'ios', 'Fixtures', 'MobileBootstrap');
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
  it('keeps an explicit fixture inventory for TypeScript and future Swift tests', () => {
    expect(
      readdirSync(FIXTURE_DIRECTORY)
        .filter((name) => name.startsWith('bootstrap-') && name.endsWith('.json'))
        .sort(),
    ).toEqual([...ACCEPTED_FIXTURES, INCOMPATIBLE_FIXTURE, REJECTED_FIXTURE].sort());
  });

  it.each(ACCEPTED_FIXTURES)('validates %s without redaction violations', (name) => {
    const raw = loadFixture(name);
    expect(findBootstrapRedactionViolations(raw)).toEqual([]);
    expect(validateBootstrapPayload(raw).success).toBe(true);
  });

  it('marks partial data non-cacheable and carries only finite section errors', () => {
    const fixture = acceptedFixture('bootstrap-partial-error.json');

    expect(fixture.meta.completeness).toEqual({
      status: 'partial',
      sectionErrors: [{ section: 'budget_pulse', code: 'calculation_failed', retryable: true }],
    });
    expect(fixture.meta.cacheability).toEqual({ status: 'not_cacheable', maxAgeSeconds: 0 });
  });

  it('does not claim client compatibility when no client version was evaluated', () => {
    const fixture = acceptedFixture('bootstrap-complete.json');

    expect(fixture.meta.server.compatibility).toEqual({
      status: 'not_evaluated',
      reason: null,
    });
    expect(fixture.meta.server.minimumClientVersion).toBe('0.1.0');
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

  it('preserves mixed Hebrew/Latin labels as JSON strings', () => {
    const fixture = acceptedFixture('bootstrap-mixed-hebrew.json');

    expect(fixture.data.recentTransactions[0].displayName).toBe('סופר שכונתי Market');
    expect(fixture.data.accounts[0].institutionName).toBe('בנק לדוגמה Example Bank');
  });

  it('preserves each original currency while keeping Home aggregates in the primary currency', () => {
    const fixture = acceptedFixture('bootstrap-mixed-currency.json');
    const transactionCurrencies = fixture.data.recentTransactions.map(
      (transaction) => transaction.amount.currencyCode,
    );

    expect(new Set(transactionCurrencies)).toEqual(new Set(['ILS', 'USD', 'EUR']));
    expect(fixture.data.home.primaryCurrencyCode).toBe('ILS');
    expect(
      Object.values(fixture.data.home.aggregates).every(
        (aggregate) => aggregate.amount.currencyCode === 'ILS',
      ),
    ).toBe(true);
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

  it('uses decimal strings for every fixture money value and integers for other numbers', () => {
    for (const name of ACCEPTED_FIXTURES) {
      const fixture = loadFixture(name);

      function inspect(value: unknown): void {
        if (typeof value === 'number') {
          expect(Number.isInteger(value), `${name} contains a floating-point number`).toBe(true);
          return;
        }
        if (value === null || typeof value !== 'object') return;
        if (Array.isArray(value)) {
          value.forEach(inspect);
          return;
        }

        const object = value as Record<string, unknown>;
        if ('currencyCode' in object && 'value' in object) {
          expect(typeof object.value, `${name} contains non-string money`).toBe('string');
          expect(object.value).toMatch(/^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$/);
        }
        Object.values(object).forEach(inspect);
      }

      inspect(fixture);
    }
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

  it('requires one coherent calculation point for Home, budget, and review', () => {
    const fixture = structuredClone(acceptedFixture('bootstrap-complete.json'));
    fixture.data.home.aggregates.income.calculatedAt = '2026-07-15T09:59:59.000Z';

    expectSchemaRejection(fixture);
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
