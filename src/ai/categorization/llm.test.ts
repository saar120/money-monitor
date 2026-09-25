const { completeSimpleMock } = vi.hoisted(() => ({ completeSimpleMock: vi.fn() }));

export {};

vi.mock('@earendil-works/pi-ai/compat', () => ({ completeSimple: completeSimpleMock }));
vi.mock('../ai-utils.js', () => ({
  resolveModel: () => ({ model: { reasoning: false }, provider: 'anthropic' }),
}));
vi.mock('../auth.js', () => ({ resolveApiKey: vi.fn().mockResolvedValue('test-key') }));
vi.mock('../../config.js', () => ({
  getBatchModelSpec: () => 'anthropic:test',
  getConfiguredBatchThinkingLevel: () => undefined,
}));

const { categorizeWithLlm } = await import('./llm.js');

describe('LLM categorization adapter', () => {
  it('preserves the existing completeSimple categorization flow', async () => {
    completeSimpleMock.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '```json\n[{"id":1,"category":"food","confidence":0.91}]\n```',
        },
      ],
    });
    const predictions = await categorizeWithLlm({
      transactions: [
        {
          id: 1,
          date: '2026-09-20',
          chargedAmount: -50,
          description: 'Cafe',
          memo: null,
          meta: null,
        } as never,
      ],
      categories: [{ name: 'food', label: 'Food', rules: 'Restaurants', ignoredFromStats: false }],
    });

    expect(predictions).toEqual([{ id: 1, category: 'food', confidence: 0.91 }]);
    expect(completeSimpleMock).toHaveBeenCalledOnce();
    expect(completeSimpleMock.mock.calls[0][1].messages[0].content).toContain('ID:1');
  });
});
