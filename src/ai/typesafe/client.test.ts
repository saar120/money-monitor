import { config } from '../../config.js';
import { evaluateTypeSafe } from './client.js';

const successResponse = {
  model: 'jev-1.13.0',
  answers: {
    transaction_1: {
      type: 'choice',
      choice: 'food',
      probabilities: { food: 0.9, other: 0.1 },
      confidence: 0.8,
    },
  },
  usage: { input_tokens: 10, output_tokens: 2 },
};

describe('evaluateTypeSafe', () => {
  beforeEach(() => {
    config.TYPESAFE_API_KEY = 'test-typesafe-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('posts the documented request and validates a Choice response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await evaluateTypeSafe({
      state: { transactions: [{ id: 1 }] },
      questions: {
        transaction_1: {
          type: 'choice',
          instructions: 'Choose a category',
          criteria: { food: 'Food', other: 'Other' },
        },
      },
    });

    expect(result.answers.transaction_1).toMatchObject({ choice: 'food', confidence: 0.8 });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.typesafe.ai/v1/systemone',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-typesafe-key',
          'Content-Type': 'application/json',
        },
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model: 'jev-latest' });
  });

  it.each([429, 529])('retries status %s with bounded backoff', async (status) => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(successResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const pending = evaluateTypeSafe({
      state: 'transaction',
      questions: {
        transaction_1: {
          type: 'choice',
          instructions: 'Choose',
          criteria: { food: 'Food', other: 'Other' },
        },
      },
    });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ model: 'jev-1.13.0' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ model: 'jev-1.13.0', answers: {} }), { status: 200 }),
        ),
    );
    await expect(evaluateTypeSafe({ state: 'x', questions: {} })).rejects.toThrow(
      'invalid response shape',
    );
  });
});
