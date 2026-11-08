import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertAccount } from '../__tests__/helpers/fixtures.js';

vi.mock('./session-map.js', () => ({
  resolveSession: () => '00000000-0000-4000-8000-000000000001',
}));

// ── Mock alert-agent ──
const mockRunAlertAgent = vi.fn();
vi.mock('../ai/alert-agent.js', () => ({
  runAlertAgent: (...args: any[]) => mockRunAlertAgent(...args),
}));

// ── Mock prompts ──
vi.mock('../ai/prompts.js', () => ({
  buildPostScrapeAlertPrompt: () => 'mock post-scrape prompt',
  buildMonthlySummaryAlertPrompt: () => 'mock monthly prompt',
  withMemory: (prompt: string) => prompt,
}));

// ── Mock alert-settings ──
const mockSettings = {
  enabled: true,
  largeChargeThreshold: 500,
  unusualSpendingPercent: 30,
  monthlySummary: { enabled: true, dayOfMonth: 1 },
  reportScrapeErrors: true,
  _lastAlertEvaluationId: undefined as number | undefined,
  _lastNetWorthTotal: undefined as number | undefined,
  _knownRecurring: undefined as string[] | undefined,
};

function resetMockSettings() {
  mockSettings.enabled = true;
  mockSettings.largeChargeThreshold = 500;
  mockSettings.unusualSpendingPercent = 30;
  mockSettings.monthlySummary = { enabled: true, dayOfMonth: 1 };
  mockSettings.reportScrapeErrors = true;
  mockSettings._lastAlertEvaluationId = undefined;
  mockSettings._lastNetWorthTotal = undefined;
  mockSettings._knownRecurring = undefined;
}

vi.mock('./alert-settings.js', () => ({
  loadAlertSettings: () => mockSettings,
  saveAlertSettings: vi.fn((s: any) => Object.assign(mockSettings, s)),
}));

// ── Mock summary service ──
const mockDetectRecurring = vi.fn().mockReturnValue({ recurring: [], total_estimated_annual: 0 });

vi.mock('../services/summary.js', () => ({
  detectRecurringTransactions: (...args: any[]) => mockDetectRecurring(...args),
}));

// ── Mock net-worth service ──
const mockGetNetWorth = vi.fn().mockResolvedValue({ total: 500000 });

vi.mock('../services/net-worth.js', () => ({
  getNetWorth: (...args: any[]) => mockGetNetWorth(...args),
}));

// ── Mock dates ──
vi.mock('../shared/dates.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/dates.js')>()),
  todayInIsrael: () => '2026-03-11',
}));

// ── Mock format ──
vi.mock('./format.js', () => ({
  markdownToTelegramHtml: (md: string) => md, // pass-through for testing
  splitMessage: (text: string) => [text],
}));

// ── Mock scraper service (types only) ──
vi.mock('../scraper/scraper.service.js', () => ({
  MANUAL_LOGIN_COMPANIES: new Set(),
  startScraping: vi.fn(),
}));

// ── Mock db/connection for stale account queries ──
let testDb: TestDb;

vi.mock('../db/connection.js', () => ({
  get db() {
    return testDb.db;
  },
  get sqlite() {
    return testDb.sqlite;
  },
  isDemoMode: () => false,
  closeAll: () => {},
}));

const {
  registerSendMessage,
  registerGetChatIds,
  registerOnAlertSent,
  runPostScrapeAlerts,
  sendMonthlySummary,
} = await import('./alerts.js');

// ── Test setup ──

let sentMessages: Array<{ chatId: number; html: string }> = [];
const mockSendMessage = vi.fn(async (chatId: number, html: string) => {
  sentMessages.push({ chatId, html });
});
let alertsSent: Array<{ chatId: number; markdown: string }> = [];
const mockOnAlertSent = vi.fn((chatId: number, markdown: string) => {
  alertsSent.push({ chatId, markdown });
});
const mockGetChatIds = vi.fn(() => [12345]);

registerSendMessage(mockSendMessage);
registerGetChatIds(mockGetChatIds);
registerOnAlertSent(mockOnAlertSent);

describe('alerts', () => {
  beforeEach(() => {
    testDb = createTestDb();
    sentMessages = [];
    alertsSent = [];
    mockSendMessage.mockClear();
    mockOnAlertSent.mockClear();
    mockGetChatIds.mockClear();
    mockRunAlertAgent.mockClear();
    mockDetectRecurring.mockClear();
    mockGetNetWorth.mockClear();
    resetMockSettings();
    mockGetChatIds.mockReturnValue([12345]);
    mockGetNetWorth.mockResolvedValue({ total: 500000 });
  });

  afterEach(() => {
    testDb?.close();
  });

  // ── runPostScrapeAlerts ──

  describe('runPostScrapeAlerts', () => {
    it('does nothing when master switch is off', async () => {
      mockSettings.enabled = false;
      await runPostScrapeAlerts([
        {
          success: true,
          accountId: 1,
          transactionsFound: 5,
          transactionsNew: 3,
          durationMs: 1000,
        },
      ]);
      expect(mockRunAlertAgent).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('does nothing when no chat IDs registered', async () => {
      mockGetChatIds.mockReturnValue([]);
      await runPostScrapeAlerts([
        {
          success: true,
          accountId: 1,
          transactionsFound: 5,
          transactionsNew: 3,
          durationMs: 1000,
        },
      ]);
      expect(mockRunAlertAgent).not.toHaveBeenCalled();
    });

    it('sends alert when agent returns a message', async () => {
      mockRunAlertAgent.mockResolvedValue('**📊 Big charge detected**\n₪850 at Shufersal');
      await runPostScrapeAlerts([
        {
          success: true,
          accountId: 1,
          transactionsFound: 10,
          transactionsNew: 3,
          durationMs: 1000,
        },
      ]);
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(sentMessages[0].html).toContain('Big charge detected');
      // Alert hook receives the original markdown for session persistence
      expect(alertsSent[0].markdown).toBe('**📊 Big charge detected**\n₪850 at Shufersal');
    });

    it('sends nothing when agent returns null (SILENT)', async () => {
      mockRunAlertAgent.mockResolvedValue(null);
      await runPostScrapeAlerts([
        {
          success: true,
          accountId: 1,
          transactionsFound: 10,
          transactionsNew: 3,
          durationMs: 1000,
        },
      ]);
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('passes scrape context and settings in user message', async () => {
      mockSettings.largeChargeThreshold = 1000;
      mockSettings.unusualSpendingPercent = 50;
      mockRunAlertAgent.mockResolvedValue(null);
      await runPostScrapeAlerts([
        {
          success: true,
          accountId: 1,
          transactionsFound: 10,
          transactionsNew: 5,
          durationMs: 1000,
        },
        {
          success: false,
          accountId: 2,
          transactionsFound: 0,
          transactionsNew: 0,
          durationMs: 500,
          error: 'Login failed',
          errorType: 'GENERAL_ERROR',
        },
      ]);
      const call = mockRunAlertAgent.mock.calls[0][0];
      expect(call.userMessage).toContain('5 new transactions');
      expect(call.userMessage).toContain('1,000'); // threshold
      expect(call.userMessage).toContain('50%'); // unusual spending
      expect(call.userMessage).toContain('Login failed'); // scrape error
    });

    it('still updates _knownRecurring and _lastNetWorthTotal after agent runs', async () => {
      mockRunAlertAgent.mockResolvedValue(null);
      mockDetectRecurring.mockReturnValue({
        recurring: [{ description: 'Netflix' }, { description: 'Spotify' }],
        total_estimated_annual: -840,
      });
      mockGetNetWorth.mockResolvedValue({ total: 600000 });
      await runPostScrapeAlerts([
        {
          success: true,
          accountId: 1,
          transactionsFound: 5,
          transactionsNew: 1,
          durationMs: 1000,
        },
      ]);
      expect(mockSettings._knownRecurring).toEqual(['Netflix', 'Spotify']);
      expect(mockSettings._lastNetWorthTotal).toBe(600000);
    });

    it('retains the baseline and surfaces an analysis failure without pretending delivery succeeded', async () => {
      mockSettings._lastNetWorthTotal = 42;
      mockRunAlertAgent.mockRejectedValue(new Error('synthetic provider failure'));
      await expect(runPostScrapeAlerts([], 'failed-analysis')).rejects.toMatchObject({
        kind: 'analysis',
      });
      await expect(runPostScrapeAlerts([], 'failed-analysis')).rejects.toMatchObject({
        kind: 'analysis',
      });
      expect(mockRunAlertAgent).toHaveBeenCalledOnce();
      expect(mockSettings._lastNetWorthTotal).toBe(42);
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('sends to all registered chat IDs', async () => {
      mockGetChatIds.mockReturnValue([111, 222, 333]);
      mockRunAlertAgent.mockResolvedValue('**Alert**');
      await runPostScrapeAlerts([
        {
          success: true,
          accountId: 1,
          transactionsFound: 5,
          transactionsNew: 1,
          durationMs: 1000,
        },
      ]);
      expect(mockSendMessage).toHaveBeenCalledTimes(3);
      expect(sentMessages[0].chatId).toBe(111);
      expect(sentMessages[1].chatId).toBe(222);
      expect(sentMessages[2].chatId).toBe(333);
    });

    it('includes stale manual-only accounts in the alert message', async () => {
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      insertAccount(testDb.db, {
        displayName: 'Stale Isracard',
        manualScrapeOnly: true,
        stalenessDays: 7,
        isActive: true,
        lastScrapedAt: tenDaysAgo.toISOString(),
      });
      insertAccount(testDb.db, {
        displayName: 'Fresh Amex',
        manualScrapeOnly: true,
        stalenessDays: 7,
        isActive: true,
        lastScrapedAt: new Date().toISOString(),
      });

      mockRunAlertAgent.mockResolvedValue('Alert message');
      await runPostScrapeAlerts([
        {
          accountId: 99,
          success: true,
          transactionsFound: 5,
          transactionsNew: 2,
          durationMs: 1000,
        },
      ]);

      const userMessage = mockRunAlertAgent.mock.calls[0][0].userMessage;
      expect(userMessage).toContain('stale-manual-accounts');
      expect(userMessage).toContain('Stale Isracard');
      expect(userMessage).toContain('Remind the user to manually scrape');
      expect(userMessage).not.toContain('Fresh Amex');
    });

    it('shows "none" for stale accounts when no manual-only accounts are stale', async () => {
      mockRunAlertAgent.mockResolvedValue('Alert message');
      await runPostScrapeAlerts([
        {
          accountId: 99,
          success: true,
          transactionsFound: 5,
          transactionsNew: 2,
          durationMs: 1000,
        },
      ]);

      const userMessage = mockRunAlertAgent.mock.calls[0][0].userMessage;
      expect(userMessage).toContain('<stale-manual-accounts>\nnone\n</stale-manual-accounts>');
    });

    it('does not alert for manual-only accounts with stalenessDays = null', async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      insertAccount(testDb.db, {
        displayName: 'No Alert Account',
        manualScrapeOnly: true,
        stalenessDays: null,
        isActive: true,
        lastScrapedAt: thirtyDaysAgo.toISOString(),
      });

      mockRunAlertAgent.mockResolvedValue('Alert message');
      await runPostScrapeAlerts([
        {
          accountId: 99,
          success: true,
          transactionsFound: 5,
          transactionsNew: 2,
          durationMs: 1000,
        },
      ]);

      const userMessage = mockRunAlertAgent.mock.calls[0][0].userMessage;
      expect(userMessage).not.toContain('No Alert Account');
    });
  });

  // ── sendMonthlySummary ──

  describe('sendMonthlySummary', () => {
    it('does nothing when master switch is off', async () => {
      mockSettings.enabled = false;
      await sendMonthlySummary();
      expect(mockRunAlertAgent).not.toHaveBeenCalled();
    });

    it('does nothing when monthlySummary is disabled', async () => {
      mockSettings.monthlySummary.enabled = false;
      await sendMonthlySummary();
      expect(mockRunAlertAgent).not.toHaveBeenCalled();
    });

    it('sends alert when agent returns a message', async () => {
      mockRunAlertAgent.mockResolvedValue('**📅 February was your best savings month**');
      await sendMonthlySummary();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(sentMessages[0].html).toContain('February');
    });

    it('sends nothing when agent returns null (SILENT)', async () => {
      mockRunAlertAgent.mockResolvedValue(null);
      await sendMonthlySummary();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('does nothing when no chat IDs registered', async () => {
      mockGetChatIds.mockReturnValue([]);
      await sendMonthlySummary();
      expect(mockRunAlertAgent).not.toHaveBeenCalled();
    });
  });
});

describe('alert evaluation and delivery recovery', () => {
  beforeEach(() => {
    testDb = createTestDb();
    resetMockSettings();
    sentMessages = [];
    alertsSent = [];
    mockRunAlertAgent.mockReset().mockResolvedValue('synthetic alert');
    mockGetChatIds.mockReturnValue([111, 222]);
    mockSendMessage.mockReset().mockImplementation(async (chatId, html) => {
      sentMessages.push({ chatId, html });
    });
    mockOnAlertSent.mockReset().mockImplementation((chatId, markdown) => {
      alertsSent.push({ chatId, markdown });
    });
  });
  afterEach(() => testDb.close());
  it('coalesces repeated job and monthly triggers and saves confirmed context per recipient', async () => {
    await Promise.all([
      runPostScrapeAlerts([], 'post-import:1'),
      runPostScrapeAlerts([], 'post-import:1'),
    ]);
    await runPostScrapeAlerts([], 'post-import:1');
    expect(mockRunAlertAgent).toHaveBeenCalledOnce();
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(alertsSent.map((value) => value.chatId)).toEqual([111, 222]);
    await Promise.all([sendMonthlySummary(), sendMonthlySummary()]);
    await sendMonthlySummary();
    expect(mockRunAlertAgent).toHaveBeenCalledTimes(2);
    expect(mockSendMessage).toHaveBeenCalledTimes(4);
  });
  it('preserves a failed recipient for explicit retry without re-analysis or duplicate successful sends', async () => {
    const { TelegramRejected, getTelegramDelivery, telegramDeliveryState } =
      await import('./delivery.js');
    const { retryAlertDelivery } = await import('./alerts.js');
    mockSendMessage.mockImplementation(async (chatId, html) => {
      if (chatId === 222) throw new TelegramRejected('synthetic recipient failure');
      sentMessages.push({ chatId, html });
    });
    await expect(runPostScrapeAlerts([], 'post-import:2')).rejects.toMatchObject({
      kind: 'failed',
    });
    expect(alertsSent.map((value) => value.chatId)).toEqual([111]);
    expect(mockSettings._lastAlertEvaluationId).toBeDefined();
    await expect(runPostScrapeAlerts([], 'post-import:2')).rejects.toMatchObject({
      kind: 'failed',
    });
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(mockRunAlertAgent).toHaveBeenCalledOnce();
    mockSendMessage.mockResolvedValue(undefined);
    expect(
      telegramDeliveryState(await retryAlertDelivery(getTelegramDelivery('post-import:2', 222)!)),
    ).toBe('sent');
    await runPostScrapeAlerts([], 'post-import:2');
    expect(mockSendMessage).toHaveBeenCalledTimes(3);
    expect(alertsSent.map((value) => value.chatId)).toEqual([111, 222]);
  });
  it('records response loss as unknown and never automatically retries that recipient', async () => {
    mockSendMessage.mockImplementation(async (chatId) => {
      if (chatId === 111) throw new Error('synthetic lost response');
    });
    await expect(runPostScrapeAlerts([], 'post-import:3')).rejects.toMatchObject({
      kind: 'unknown',
    });
    await expect(runPostScrapeAlerts([], 'post-import:3')).rejects.toMatchObject({
      kind: 'unknown',
    });
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(mockRunAlertAgent).toHaveBeenCalledOnce();
    expect(alertsSent.map((value) => value.chatId)).toEqual([222]);
  });
  it('merges baseline updates with settings edited during analysis and does not rewind newer baselines', async () => {
    let finish!: (message: null) => void;
    mockRunAlertAgent.mockImplementationOnce(
      () =>
        new Promise<null>((resolve) => {
          finish = resolve;
        }),
    );
    const old = runPostScrapeAlerts([], 'old-job');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    mockSettings.largeChargeThreshold = 999;
    mockGetNetWorth.mockResolvedValue({ total: 10 });
    finish(null);
    await old;
    expect(mockSettings.largeChargeThreshold).toBe(999);
    mockGetNetWorth.mockResolvedValue({ total: 20 });
    await runPostScrapeAlerts([], 'new-job');
    await runPostScrapeAlerts([], 'old-job');
    expect(mockSettings._lastNetWorthTotal).toBe(20);
  });
});
