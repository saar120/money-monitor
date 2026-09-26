import type { Transaction } from '../../shared/types.js';
import type { TypeSafeResponse } from '../typesafe/client.js';

const { evaluateTypeSafeMock } = vi.hoisted(() => ({ evaluateTypeSafeMock: vi.fn() }));
vi.mock('../typesafe/client.js', () => ({ evaluateTypeSafe: evaluateTypeSafeMock }));

const { categorizeWithTypeSafe } = await import('./typesafe.js');

function transaction(id: number): Transaction {
  return {
    id,
    accountId: 1,
    identifier: id * 10,
    date: '2026-09-20',
    effectiveDate: null,
    reportingDate: '2026-09-20',
    processedDate: '2026-09-21',
    originalAmount: -42.5,
    originalCurrency: 'USD',
    chargedAmount: -139.7,
    chargedCurrency: 'ILS',
    description: 'Example Merchant',
    memo: 'Team dinner',
    type: 'normal',
    status: 'completed',
    installmentNumber: 2,
    installmentTotal: 4,
    category: null,
    expenseOwnerType: 'unassigned',
    expenseOwnerMemberId: null,
    ownerSource: 'unassigned',
    ownerConfidence: null,
    ownerReviewReason: null,
    meta: JSON.stringify({ bankCategory: 'Restaurants', internal: 'excluded' }),
    ignored: false,
    needsReview: false,
    reviewReason: null,
    confidence: null,
    hash: `secret-hash-${id}`,
    createdAt: '2026-09-21 00:00:00',
    scrapeSessionId: null,
  };
}

const categoryRows = [
  {
    name: 'food',
    label: 'Food & Dining',
    rules: 'Restaurants and groceries',
    ignoredFromStats: false,
  },
  { name: 'other', label: 'Other', rules: null, ignoredFromStats: true },
];

function responseForQuestions(questions: Record<string, unknown>): TypeSafeResponse {
  return {
    model: 'jev-1.13.0',
    answers: Object.fromEntries(
      Object.keys(questions).map((id) => [
        id,
        {
          type: 'choice' as const,
          choice: 'food',
          probabilities: { food: 0.9, other: 0.1 },
          confidence: 0.85,
        },
      ]),
    ),
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

describe('TypeSafe categorization adapter', () => {
  beforeEach(() => {
    evaluateTypeSafeMock.mockReset();
    evaluateTypeSafeMock.mockImplementation(({ questions }) =>
      Promise.resolve(responseForQuestions(questions)),
    );
  });

  it('chunks transactions into ten independent questions per request', async () => {
    const predictions = await categorizeWithTypeSafe({
      transactions: Array.from({ length: 21 }, (_, index) => transaction(index + 1)),
      categories: categoryRows,
    });
    expect(evaluateTypeSafeMock).toHaveBeenCalledTimes(3);
    expect(Object.keys(evaluateTypeSafeMock.mock.calls[0][0].questions)).toHaveLength(10);
    expect(Object.keys(evaluateTypeSafeMock.mock.calls[1][0].questions)).toHaveLength(10);
    expect(Object.keys(evaluateTypeSafeMock.mock.calls[2][0].questions)).toHaveLength(1);
    expect(predictions).toHaveLength(21);
  });

  it('includes complete relevant evidence and dynamic category criteria', async () => {
    await categorizeWithTypeSafe({ transactions: [transaction(7)], categories: categoryRows });
    const request = evaluateTypeSafeMock.mock.calls[0][0];
    expect(request.state.transactions[0]).toEqual({
      id: 7,
      date: '2026-09-20',
      original_amount: -42.5,
      charged_amount: -139.7,
      original_currency: 'USD',
      charged_currency: 'ILS',
      description: 'Example Merchant',
      memo: 'Team dinner',
      transaction_type: 'normal',
      status: 'completed',
      bank_category: 'Restaurants',
      installment_number: 2,
      installment_total: 4,
      amount_direction: 'outflow',
    });
    expect(JSON.stringify(request.state)).not.toContain('secret-hash');
    expect(JSON.stringify(request.state)).not.toContain('internal');
    expect(request.questions.transaction_7.criteria).toEqual({
      food: { label: 'Food & Dining', description: 'Restaurants and groceries' },
      other: 'Other',
    });
  });

  it('rejects invalid category choices', async () => {
    evaluateTypeSafeMock.mockResolvedValue({
      ...responseForQuestions({ transaction_1: {} }),
      answers: {
        transaction_1: {
          type: 'choice',
          choice: 'invented',
          probabilities: { invented: 1 },
          confidence: 1,
        },
      },
    });
    await expect(
      categorizeWithTypeSafe({ transactions: [transaction(1)], categories: categoryRows }),
    ).rejects.toThrow('invalid category');
  });

  it('rejects answer IDs outside the requested transaction set', async () => {
    evaluateTypeSafeMock.mockResolvedValue({
      ...responseForQuestions({ transaction_1: {} }),
      answers: {
        transaction_999: {
          type: 'choice',
          choice: 'food',
          probabilities: { food: 1 },
          confidence: 1,
        },
      },
    });
    await expect(
      categorizeWithTypeSafe({ transactions: [transaction(1)], categories: categoryRows }),
    ).rejects.toThrow('invalid transaction answer');
  });
});
