import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertAccount } from '../__tests__/helpers/fixtures.js';

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
  _lastNetWorthTotal: undefined as number | undefined,
  _knownRecurring: undefined as string[] | undefined,
};

function resetMockSettings() {
  mockSettings.enabled = true;
  mockSettings.largeChargeThreshold = 500;
  mockSettings.unusualSpendingPercent = 30;
  mockSettings.monthlySummary = { enabled: true, dayOfMonth: 1 };
  mockSettings.reportScrapeErrors = true;
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
vi.mock('../shared/dates.js', () => ({
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

  afterAll(() => {
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

    it('handles agent failure gracefully (no message sent)', async () => {
      mockRunAlertAgent.mockRejectedValue(new Error('API key expired'));
      await runPostScrapeAlerts([
        {
          success: true,
          accountId: 1,
          transactionsFound: 5,
          transactionsNew: 1,
          durationMs: 1000,
        },
      ]);
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
