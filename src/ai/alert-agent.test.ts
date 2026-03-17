import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Agent class
const mockPrompt = vi.fn();
const mockSubscribe = vi.fn();
const mockAbort = vi.fn();

vi.mock('@mariozechner/pi-agent-core', () => {
  return {
    Agent: class MockAgent {
      prompt = mockPrompt;
      subscribe = mockSubscribe;
      abort = mockAbort;
      replaceMessages = vi.fn();
    },
  };
});

vi.mock('@mariozechner/pi-ai', () => ({
  getModel: vi.fn().mockReturnValue({}),
}));

vi.mock('../config.js', () => ({
  config: { AI_MAX_TURNS: 8 },
  parseModelSpec: () => ({ provider: 'anthropic', model: 'claude-sonnet-4-6' }),
  getAIModelSpec: () => 'anthropic:claude-sonnet-4-6',
}));

vi.mock('./auth.js', () => ({
  resolveApiKey: vi.fn().mockResolvedValue('test-key'),
  loadCredentials: vi.fn(),
}));

// Mock tool builders to avoid loading the real database
vi.mock('./tools.js', () => ({
  buildQueryTransactionsTool: vi.fn().mockReturnValue({}),
  buildGetSpendingSummaryTool: vi.fn().mockReturnValue({}),
  buildGetAccountBalancesTool: vi.fn().mockReturnValue({}),
  buildComparePeriodsTool: vi.fn().mockReturnValue({}),
  buildGetSpendingTrendsTool: vi.fn().mockReturnValue({}),
  buildDetectRecurringTransactionsTool: vi.fn().mockReturnValue({}),
  buildGetTopMerchantsTool: vi.fn().mockReturnValue({}),
  buildGetLatestScrapeTransactionsTool: vi.fn().mockReturnValue({}),
}));

vi.mock('./asset-tools.js', () => ({
  buildGetNetWorthTool: vi.fn().mockReturnValue({}),
  buildGetLiabilitiesTool: vi.fn().mockReturnValue({}),
  buildGetNetWorthHistoryTool: vi.fn().mockReturnValue({}),
}));

const { runAlertAgent } = await import('./alert-agent.js');

describe('runAlertAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when agent responds with [SILENT]', async () => {
    mockSubscribe.mockImplementation((cb: (event: any) => void) => {
      setTimeout(() => {
        cb({
          type: 'agent_end',
          messages: [
            {
              role: 'assistant',
              content: [{ type: 'text', text: '[SILENT]' }],
            },
          ],
        });
      }, 0);
      return vi.fn(); // unsubscribe
    });
    mockPrompt.mockResolvedValue(undefined);

    const result = await runAlertAgent({
      systemPrompt: 'test prompt',
      userMessage: 'test message',
    });

    expect(result).toBeNull();
  });

  it('returns message text when agent responds with content', async () => {
    mockSubscribe.mockImplementation((cb: (event: any) => void) => {
      setTimeout(() => {
        cb({
          type: 'agent_end',
          messages: [
            {
              role: 'assistant',
              content: [
                { type: 'text', text: '**📊 You had a big charge today**\n\n₪850 at Shufersal' },
              ],
            },
          ],
        });
      }, 0);
      return vi.fn(); // unsubscribe
    });
    mockPrompt.mockResolvedValue(undefined);

    const result = await runAlertAgent({
      systemPrompt: 'test prompt',
      userMessage: 'test message',
    });

    expect(result).toContain('big charge');
    expect(result).toContain('Shufersal');
  });
});
