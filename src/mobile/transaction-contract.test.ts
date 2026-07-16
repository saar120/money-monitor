import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMobilePublicIdProjector } from './mobile-public-id.js';
import {
  mobileTransactionQuerySchema,
  validateMobileTransactionDetailEnvelope,
  validateMobileTransactionListEnvelope,
} from './transaction-contract.js';

const project = createMobilePublicIdProjector('production-mobile-public-id-key-32-chars-minimum');
const FIXTURE_DIRECTORY = join(process.cwd(), 'ios', 'Fixtures', 'MobileBootstrap');

function loadTransactionFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIRECTORY, name), 'utf8')) as unknown;
}

interface SearchNormalizationVector {
  name: string;
  input: string;
  expected: string;
}

function loadSearchNormalizationVectors(): SearchNormalizationVector[] {
  return loadTransactionFixture(
    'transaction-search-normalization.json',
  ) as SearchNormalizationVector[];
}

function item(id = 1) {
  return {
    id: project('transaction', id),
    occurredOn: '2026-07-15',
    displayName: 'רמי לוי Market',
    amount: { value: '125.50', currencyCode: 'ILS' },
    direction: 'debit',
    status: 'posted',
    category: { id: project('category', 3), label: 'Groceries' },
    account: {
      id: project('account', 2),
      displayName: 'Primary Account',
      identifierMask: '•••• 3456',
    },
    needsReview: false,
    excludedFromReports: false,
  };
}

function meta() {
  return {
    apiVersion: '1',
    generatedAt: '2026-07-16T08:00:00.000Z',
    source: 'live',
    server: {
      id: '11111111-1111-4111-8111-111111111111',
      protocolVersion: 1,
    },
  };
}

function listEnvelope() {
  return {
    data: {
      financialDate: '2026-07-16',
      transactions: [item()],
      page: { hasMore: false, nextCursor: null },
    },
    meta: meta(),
  };
}

describe('mobile transaction query contract', () => {
  it('normalizes NFKC search text and applies bounded defaults', () => {
    const result = mobileTransactionQuerySchema.parse({
      q: '  Ｍａｒｋｅｔ   רמי  ',
      includeExcluded: 'false',
      needsReview: 'true',
      limit: '40',
    });

    expect(result).toEqual({
      q: 'Market רמי',
      includeExcluded: false,
      needsReview: true,
      limit: 40,
    });
    expect(mobileTransactionQuerySchema.parse({})).toEqual({
      limit: 30,
      includeExcluded: false,
    });
  });

  it.each([
    { q: 'x'.repeat(101) },
    { limit: '51' },
    { startDate: '2026-02-30' },
    { startDate: '2026-07-20', endDate: '2026-07-01' },
    { accountId: 'account_42' },
    { unexpected: 'field' },
  ])('rejects invalid or unrecognized query input %#', (input) => {
    expect(mobileTransactionQuerySchema.safeParse(input).success).toBe(false);
  });

  it.each(loadSearchNormalizationVectors())(
    'matches the shared normalization vector: $name',
    ({ input, expected }) => {
      expect(mobileTransactionQuerySchema.parse({ q: input }).q).toBe(expected);
    },
  );
});

describe('mobile transaction response contract', () => {
  it('validates the shared Swift and TypeScript transaction fixtures', () => {
    expect(
      validateMobileTransactionListEnvelope(loadTransactionFixture('transaction-list-live.json'))
        .success,
    ).toBe(true);
    expect(
      validateMobileTransactionDetailEnvelope(
        loadTransactionFixture('transaction-detail-live.json'),
      ).success,
    ).toBe(true);
  });

  it('accepts the exact list envelope and strips nothing', () => {
    expect(validateMobileTransactionListEnvelope(listEnvelope())).toEqual({
      success: true,
      data: listEnvelope(),
    });
  });

  it.each([
    [
      'duplicate IDs',
      (value: ReturnType<typeof listEnvelope>) => value.data.transactions.push(item()),
    ],
    [
      'future transaction',
      (value: ReturnType<typeof listEnvelope>) => {
        value.data.transactions[0].occurredOn = '2026-07-17';
      },
    ],
    [
      'cursor contradiction',
      (value: ReturnType<typeof listEnvelope>) => {
        value.data.page = { hasMore: true, nextCursor: null };
      },
    ],
    [
      'unknown field',
      (value: ReturnType<typeof listEnvelope>) => {
        Object.assign(value.data.transactions[0], { memo: 'private' });
      },
    ],
    [
      'floating money',
      (value: ReturnType<typeof listEnvelope>) => {
        Object.assign(value.data.transactions[0].amount, { value: 1.25 });
      },
    ],
  ])('rejects %s', (_name, mutate) => {
    const value = listEnvelope();
    mutate(value);
    expect(validateMobileTransactionListEnvelope(value).success).toBe(false);
  });

  it('rejects raw-row keys and secret-like values before schema parsing', () => {
    const value = listEnvelope();
    Object.assign(value.data.transactions[0], {
      accountNumber: '1234567890123456',
      harmlessFutureField: 'FORBIDDEN_SECRET_SENTINEL',
    });
    const result = validateMobileTransactionListEnvelope(value);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.every((issue) => issue.code === 'redaction_violation')).toBe(true);
    }
  });

  it('accepts only the safe owner shape in detail', () => {
    const accepted = {
      data: {
        transaction: { ...item(), owner: { kind: 'member', displayName: 'Saar' } },
      },
      meta: meta(),
    };
    expect(validateMobileTransactionDetailEnvelope(accepted).success).toBe(true);

    expect(
      validateMobileTransactionDetailEnvelope({
        ...accepted,
        data: {
          transaction: { ...item(), owner: { kind: 'shared', displayName: 'Saar' } },
        },
      }).success,
    ).toBe(false);
  });
});
