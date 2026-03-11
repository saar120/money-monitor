import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { insertAccount, insertTransaction, insertCategory } from '../__tests__/helpers/fixtures.js';

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

// ── Mock alert-settings ──
const mockSettings = {
  enabled: true,
  dailyDigest: { enabled: true, largeChargeThreshold: 500, reportErrors: true },
  unusualSpending: { enabled: true, percentThreshold: 30 },
  newRecurring: { enabled: true },
  reviewReminder: { enabled: true },
  monthlySummary: { enabled: true },
  netWorthChange: { enabled: true, changeThreshold: 10000, milestoneInterval: 100000 },
  _lastNetWorthTotal: undefined as number | undefined,
  _knownRecurring: undefined as string[] | undefined,
};

function resetMockSettings() {
  mockSettings.enabled = true;
  mockSettings.dailyDigest = { enabled: true, largeChargeThreshold: 500, reportErrors: true };
  mockSettings.unusualSpending = { enabled: true, percentThreshold: 30 };
  mockSettings.newRecurring = { enabled: true };
  mockSettings.reviewReminder = { enabled: true };
  mockSettings.monthlySummary = { enabled: true };
  mockSettings.netWorthChange = {
    enabled: true,
    changeThreshold: 10000,
    milestoneInterval: 100000,
  };
  mockSettings._lastNetWorthTotal = undefined;
  mockSettings._knownRecurring = undefined;
}

vi.mock('./alert-settings.js', () => ({
  loadAlertSettings: () => mockSettings,
  saveAlertSettings: vi.fn((s: any) => Object.assign(mockSettings, s)),
}));

// ── Mock summary service ──
const mockComparePeriods = vi.fn().mockReturnValue({
  comparison: [],
  summary: { period1: { total: 0 }, period2: { total: 0 }, change_amount: 0, change_percent: null },
});
const mockDetectRecurring = vi.fn().mockReturnValue({ recurring: [], total_estimated_annual: 0 });
const mockGetSpendingSummary = vi.fn().mockReturnValue({ summary: [], groupBy: 'category' });
const mockGetSpendingTrends = vi.fn().mockReturnValue({ trends: [] });

vi.mock('../services/summary.js', () => ({
  comparePeriods: (...args: any[]) => mockComparePeriods(...args),
  detectRecurringTransactions: (...args: any[]) => mockDetectRecurring(...args),
  getSpendingSummary: (...args: any[]) => mockGetSpendingSummary(...args),
  getSpendingTrends: (...args: any[]) => mockGetSpendingTrends(...args),
}));

// ── Mock net-worth service ──
const mockGetNetWorth = vi.fn().mockResolvedValue({ total: 500000 });

vi.mock('../services/net-worth.js', () => ({
  getNetWorth: (...args: any[]) => mockGetNetWorth(...args),
}));

// ── Mock dates ──
vi.mock('../shared/dates.js', () => ({
  todayInIsrael: () => '2026-03-11',
  monthsAgoStart: (months: number) => {
    const d = new Date(2026, 2 - months, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  },
}));

// ── Mock format ──
vi.mock('./format.js', () => ({
  markdownToTelegramHtml: (md: string) => md, // pass-through for testing
  splitMessage: (text: string) => [text], // return single chunk
}));

// ── Mock scraper service (types only) ──
vi.mock('../scraper/scraper.service.js', () => ({
  MANUAL_LOGIN_COMPANIES: new Set(),
  startScraping: vi.fn(),
}));

const {
  registerSendMessage,
  registerGetChatIds,
  sendPostScrapeDigest,
  checkUnusualSpending,
  checkNewRecurring,
  checkNetWorthChanges,
  sendMonthlySummary,
  checkReviewNeeded,
} = await import('./alerts.js');

// ── Test setup ──

let sentMessages: Array<{ chatId: number; html: string }> = [];
const mockSendMessage = vi.fn(async (chatId: number, html: string) => {
  sentMessages.push({ chatId, html });
});
const mockGetChatIds = vi.fn(() => [12345]);

// Register the mock functions
registerSendMessage(mockSendMessage);
registerGetChatIds(mockGetChatIds);

describe('alerts', () => {
  beforeEach(() => {
    // Fake timers so yesterdayInIsrael() (uses new Date()) stays consistent
    // with the mocked todayInIsrael() returning '2026-03-11'
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-11T12:00:00+03:00'));
    testDb = createTestDb();
    sentMessages = [];
    mockSendMessage.mockClear();
    mockGetChatIds.mockClear();
    mockComparePeriods.mockClear();
    mockDetectRecurring.mockClear();
    mockGetSpendingSummary.mockClear();
    mockGetNetWorth.mockClear();
    resetMockSettings();
    mockGetChatIds.mockReturnValue([12345]);
    mockGetNetWorth.mockResolvedValue({ total: 500000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Master enabled switch ──

  describe('master enabled switch', () => {
    it('sendPostScrapeDigest does nothing when master switch is off', async () => {
      mockSettings.enabled = false;
      await sendPostScrapeDigest([
        { success: true, accountId: 1, transactionsFound: 5, transactionsNew: 3, durationMs: 1000 },
      ]);
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('checkUnusualSpending does nothing when master switch is off', async () => {
      mockSettings.enabled = false;
      await checkUnusualSpending();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('checkNewRecurring does nothing when master switch is off', async () => {
      mockSettings.enabled = false;
      await checkNewRecurring();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('checkNetWorthChanges does nothing when master switch is off', async () => {
      mockSettings.enabled = false;
      await checkNetWorthChanges();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('sendMonthlySummary does nothing when master switch is off', async () => {
      mockSettings.enabled = false;
      await sendMonthlySummary();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('checkReviewNeeded does nothing when master switch is off', async () => {
      mockSettings.enabled = false;
      await checkReviewNeeded();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  // ── Individual enabled switches ──

  describe('individual enabled switches', () => {
    it('sendPostScrapeDigest does nothing when dailyDigest is disabled', async () => {
      mockSettings.dailyDigest.enabled = false;
      await sendPostScrapeDigest([
        { success: true, accountId: 1, transactionsFound: 5, transactionsNew: 3, durationMs: 1000 },
      ]);
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('checkUnusualSpending does nothing when unusualSpending is disabled', async () => {
      mockSettings.unusualSpending.enabled = false;
      await checkUnusualSpending();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('checkNewRecurring does nothing when newRecurring is disabled', async () => {
      mockSettings.newRecurring.enabled = false;
      await checkNewRecurring();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('checkNetWorthChanges does nothing when netWorthChange is disabled', async () => {
      mockSettings.netWorthChange.enabled = false;
      await checkNetWorthChanges();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('sendMonthlySummary does nothing when monthlySummary is disabled', async () => {
      mockSettings.monthlySummary.enabled = false;
      await sendMonthlySummary();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('checkReviewNeeded does nothing when reviewReminder is disabled', async () => {
      mockSettings.reviewReminder.enabled = false;
      await checkReviewNeeded();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  // ── No chat IDs ──

  describe('no chat IDs', () => {
    it('does nothing when no chat IDs are registered', async () => {
      mockGetChatIds.mockReturnValue([]);
      await sendPostScrapeDigest([
        { success: true, accountId: 1, transactionsFound: 5, transactionsNew: 3, durationMs: 1000 },
      ]);
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  // ── sendPostScrapeDigest ──

  describe('sendPostScrapeDigest', () => {
    it('sends "no new transactions" when totalNew is 0', async () => {
      await sendPostScrapeDigest([
        {
          success: true,
          accountId: 1,
          transactionsFound: 10,
          transactionsNew: 0,
          durationMs: 1000,
        },
      ]);

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const msg = sentMessages[0].html;
      expect(msg).toContain('Scrape Complete');
      expect(msg).toContain('No new transactions found');
    });

    it('includes new transaction count and spending when there are new transactions', async () => {
      const account = insertAccount(testDb.db);
      // todayInIsrael is mocked to '2026-03-11'; yesterdayInIsrael uses real Date
      // Use '2026-03-11' (mocked today) for transactions to ensure they fall within the query range
      const mockedToday = '2026-03-11';
      insertTransaction(testDb.db, account.id, {
        date: mockedToday,
        processedDate: mockedToday,
        chargedAmount: -200,
        description: 'Grocery Store',
        ignored: false,
      });
      insertTransaction(testDb.db, account.id, {
        date: mockedToday,
        processedDate: mockedToday,
        chargedAmount: 5000,
        description: 'Salary',
        ignored: false,
      });

      await sendPostScrapeDigest([
        {
          success: true,
          accountId: account.id,
          transactionsFound: 10,
          transactionsNew: 2,
          durationMs: 1000,
        },
      ]);

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const msg = sentMessages[0].html;
      expect(msg).toContain('**2** new transactions found');
      expect(msg).toContain('Spending:');
      expect(msg).toContain('Income:');
    });

    it('flags large charges above threshold', async () => {
      const account = insertAccount(testDb.db);
      const mockedToday = '2026-03-11';
      insertTransaction(testDb.db, account.id, {
        date: mockedToday,
        processedDate: mockedToday,
        chargedAmount: -800,
        description: 'Expensive Purchase',
        ignored: false,
      });
      insertTransaction(testDb.db, account.id, {
        date: mockedToday,
        processedDate: mockedToday,
        chargedAmount: -50,
        description: 'Small Purchase',
        ignored: false,
      });

      await sendPostScrapeDigest([
        {
          success: true,
          accountId: account.id,
          transactionsFound: 10,
          transactionsNew: 2,
          durationMs: 1000,
        },
      ]);

      const msg = sentMessages[0].html;
      expect(msg).toContain('Large charges');
      expect(msg).toContain('Expensive Purchase');
      expect(msg).not.toContain('Small Purchase');
    });

    it('reports scrape failures when reportErrors is enabled', async () => {
      const account = insertAccount(testDb.db, { displayName: 'My Bank' });

      await sendPostScrapeDigest([
        {
          success: false,
          accountId: account.id,
          transactionsFound: 0,
          transactionsNew: 0,
          durationMs: 1000,
          error: 'Login failed',
          errorType: 'GENERAL_ERROR',
        },
      ]);

      const msg = sentMessages[0].html;
      expect(msg).toContain('scrape error');
      expect(msg).toContain('My Bank');
      expect(msg).toContain('Login failed');
    });

    it('does not report failures when reportErrors is disabled', async () => {
      mockSettings.dailyDigest.reportErrors = false;
      const account = insertAccount(testDb.db, { displayName: 'My Bank' });

      await sendPostScrapeDigest([
        {
          success: false,
          accountId: account.id,
          transactionsFound: 0,
          transactionsNew: 0,
          durationMs: 1000,
          error: 'Login failed',
        },
      ]);

      const msg = sentMessages[0].html;
      expect(msg).not.toContain('scrape error');
      expect(msg).not.toContain('My Bank');
    });

    it('sends to all registered chat IDs', async () => {
      mockGetChatIds.mockReturnValue([111, 222, 333]);

      await sendPostScrapeDigest([
        { success: true, accountId: 1, transactionsFound: 5, transactionsNew: 0, durationMs: 1000 },
      ]);

      expect(mockSendMessage).toHaveBeenCalledTimes(3);
      expect(sentMessages[0].chatId).toBe(111);
      expect(sentMessages[1].chatId).toBe(222);
      expect(sentMessages[2].chatId).toBe(333);
    });
  });

  // ── checkUnusualSpending ──

  describe('checkUnusualSpending', () => {
    it('does not send alert when no spending spikes', async () => {
      mockComparePeriods.mockReturnValue({
        comparison: [
          {
            category: 'food',
            period1_total: -100,
            period2_total: -110,
            change_amount: -10,
            change_percent: -10,
          },
        ],
        summary: {
          period1: { total: -100 },
          period2: { total: -110 },
          change_amount: -10,
          change_percent: -10,
        },
      });

      await checkUnusualSpending();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('sends alert when spending exceeds threshold percentage', async () => {
      // Use a unique category name to avoid UNIQUE constraint conflicts with seeded data
      const catName = `test_food_${Date.now()}`;
      insertCategory(testDb.db, { name: catName, label: 'Food & Dining' });

      mockComparePeriods.mockReturnValue({
        comparison: [
          {
            category: catName,
            period1_total: -100,
            period2_total: -200,
            change_amount: -100,
            change_percent: -100,
          },
        ],
        summary: {
          period1: { total: -100 },
          period2: { total: -200 },
          change_amount: -100,
          change_percent: -100,
        },
      });

      await checkUnusualSpending();

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const msg = sentMessages[0].html;
      expect(msg).toContain('Unusual Spending');
      expect(msg).toContain('Food & Dining');
      expect(msg).toContain('higher');
    });

    it('only flags spending categories (negative amounts)', async () => {
      const spendCat = `test_spend_${Date.now()}`;
      const incomeCat = `test_income_${Date.now()}`;

      mockComparePeriods.mockReturnValue({
        comparison: [
          // Income category with big increase (positive amounts) - should NOT trigger
          {
            category: incomeCat,
            period1_total: 5000,
            period2_total: 10000,
            change_amount: 5000,
            change_percent: 100,
          },
          // Spending with big increase - should trigger
          {
            category: spendCat,
            period1_total: -100,
            period2_total: -200,
            change_amount: -100,
            change_percent: -100,
          },
        ],
        summary: {
          period1: { total: 4900 },
          period2: { total: 9800 },
          change_amount: 4900,
          change_percent: 100,
        },
      });

      await checkUnusualSpending();

      const msg = sentMessages[0].html;
      expect(msg).not.toContain(incomeCat);
      expect(msg).toContain(spendCat);
    });

    it('respects custom threshold', async () => {
      mockSettings.unusualSpending.percentThreshold = 50;

      mockComparePeriods.mockReturnValue({
        comparison: [
          // 40% increase - below the 50% threshold
          {
            category: 'food',
            period1_total: -100,
            period2_total: -140,
            change_amount: -40,
            change_percent: -40,
          },
        ],
        summary: {
          period1: { total: -100 },
          period2: { total: -140 },
          change_amount: -40,
          change_percent: -40,
        },
      });

      await checkUnusualSpending();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  // ── checkNewRecurring ──

  describe('checkNewRecurring', () => {
    it('sends alert for newly detected recurring charges', async () => {
      mockSettings._knownRecurring = ['Netflix'];
      mockDetectRecurring.mockReturnValue({
        recurring: [
          {
            description: 'Netflix',
            avg_amount: -50,
            frequency: 'monthly',
            estimated_annual_cost: -600,
          },
          {
            description: 'Spotify',
            avg_amount: -20,
            frequency: 'monthly',
            estimated_annual_cost: -240,
          },
        ],
        total_estimated_annual: -840,
      });

      await checkNewRecurring();

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const msg = sentMessages[0].html;
      expect(msg).toContain('New Recurring');
      expect(msg).toContain('Spotify');
      expect(msg).not.toContain('Netflix'); // Netflix is already known
    });

    it('does not send alert when no new recurring charges', async () => {
      mockSettings._knownRecurring = ['Netflix', 'Spotify'];
      mockDetectRecurring.mockReturnValue({
        recurring: [
          {
            description: 'Netflix',
            avg_amount: -50,
            frequency: 'monthly',
            estimated_annual_cost: -600,
          },
          {
            description: 'Spotify',
            avg_amount: -20,
            frequency: 'monthly',
            estimated_annual_cost: -240,
          },
        ],
        total_estimated_annual: -840,
      });

      await checkNewRecurring();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('updates _knownRecurring after check', async () => {
      mockSettings._knownRecurring = [];
      mockDetectRecurring.mockReturnValue({
        recurring: [
          {
            description: 'Netflix',
            avg_amount: -50,
            frequency: 'monthly',
            estimated_annual_cost: -600,
          },
        ],
        total_estimated_annual: -600,
      });

      await checkNewRecurring();

      // saveAlertSettings should have been called with updated knownRecurring
      expect(mockSettings._knownRecurring).toEqual(['Netflix']);
    });

    it('treats empty _knownRecurring as all new', async () => {
      mockSettings._knownRecurring = undefined;
      mockDetectRecurring.mockReturnValue({
        recurring: [
          {
            description: 'Netflix',
            avg_amount: -50,
            frequency: 'monthly',
            estimated_annual_cost: -600,
          },
          {
            description: 'Spotify',
            avg_amount: -20,
            frequency: 'monthly',
            estimated_annual_cost: -240,
          },
        ],
        total_estimated_annual: -840,
      });

      await checkNewRecurring();

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const msg = sentMessages[0].html;
      expect(msg).toContain('Netflix');
      expect(msg).toContain('Spotify');
    });
  });

  // ── checkNetWorthChanges ──

  describe('checkNetWorthChanges', () => {
    it('records first net worth without sending alert', async () => {
      mockSettings._lastNetWorthTotal = undefined;
      mockGetNetWorth.mockResolvedValue({ total: 500000 });

      await checkNetWorthChanges();

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockSettings._lastNetWorthTotal).toBe(500000);
    });

    it('detects milestone crossing upward', async () => {
      mockSettings._lastNetWorthTotal = 490000;
      mockGetNetWorth.mockResolvedValue({ total: 510000 });

      await checkNetWorthChanges();

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const msg = sentMessages[0].html;
      expect(msg).toContain('Milestone');
      expect(msg).toContain('500,000');
    });

    it('detects milestone crossing downward', async () => {
      mockSettings._lastNetWorthTotal = 510000;
      mockGetNetWorth.mockResolvedValue({ total: 490000 });

      await checkNetWorthChanges();

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const msg = sentMessages[0].html;
      expect(msg).toContain('Net Worth Alert');
      expect(msg).toContain('dropped below');
    });

    it('detects significant change without milestone crossing', async () => {
      // Net worth changed by 15000 (above 10000 threshold) but no milestone crossing
      mockSettings._lastNetWorthTotal = 520000;
      mockGetNetWorth.mockResolvedValue({ total: 535000 });

      await checkNetWorthChanges();

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const msg = sentMessages[0].html;
      expect(msg).toContain('increased');
      expect(msg).toContain('15,000');
    });

    it('does not send alert for small changes', async () => {
      mockSettings._lastNetWorthTotal = 500000;
      mockGetNetWorth.mockResolvedValue({ total: 505000 }); // 5000 change, below 10000 threshold

      await checkNetWorthChanges();

      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('always updates _lastNetWorthTotal after check', async () => {
      mockSettings._lastNetWorthTotal = 500000;
      mockGetNetWorth.mockResolvedValue({ total: 502000 });

      await checkNetWorthChanges();

      expect(mockSettings._lastNetWorthTotal).toBe(502000);
    });

    it('handles getNetWorth failure gracefully', async () => {
      mockSettings._lastNetWorthTotal = 500000;
      mockGetNetWorth.mockRejectedValue(new Error('Exchange rate unavailable'));

      await checkNetWorthChanges(); // should not throw

      expect(mockSendMessage).not.toHaveBeenCalled();
      // _lastNetWorthTotal should remain unchanged
      expect(mockSettings._lastNetWorthTotal).toBe(500000);
    });
  });

  // ── sendMonthlySummary ──

  describe('sendMonthlySummary', () => {
    it('formats monthly summary with income, spending, and savings rate', async () => {
      // Mock cashflow summary
      mockGetSpendingSummary
        .mockReturnValueOnce({
          summary: [{ month: '2026-02', income: 15000, expense: 10000 }],
          groupBy: 'cashflow',
        })
        .mockReturnValueOnce({
          summary: [
            { category: 'food', totalAmount: -3000 },
            { category: 'transport', totalAmount: -2000 },
            { category: 'housing', totalAmount: -5000 },
          ],
          groupBy: 'category',
        });

      mockComparePeriods.mockReturnValue({
        comparison: [],
        summary: {
          period1: { total: -9000 },
          period2: { total: -10000 },
          change_amount: -1000,
          change_percent: -11,
        },
      });

      await sendMonthlySummary();

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const msg = sentMessages[0].html;
      expect(msg).toContain('Monthly Summary');
      expect(msg).toContain('Feb');
      expect(msg).toContain('Income');
      expect(msg).toContain('Spending');
      expect(msg).toContain('savings rate');
    });

    it('includes top spending categories', async () => {
      const foodCat = `test_food_${Date.now()}`;
      const housingCat = `test_housing_${Date.now()}`;
      insertCategory(testDb.db, { name: foodCat, label: 'Food & Dining' });
      insertCategory(testDb.db, { name: housingCat, label: 'Housing' });

      mockGetSpendingSummary
        .mockReturnValueOnce({
          summary: [{ month: '2026-02', income: 15000, expense: 10000 }],
          groupBy: 'cashflow',
        })
        .mockReturnValueOnce({
          summary: [
            { category: foodCat, totalAmount: -3000 },
            { category: housingCat, totalAmount: -5000 },
          ],
          groupBy: 'category',
        });

      mockComparePeriods.mockReturnValue({
        comparison: [],
        summary: {
          period1: { total: -8000 },
          period2: { total: -8000 },
          change_amount: 0,
          change_percent: 0,
        },
      });

      await sendMonthlySummary();

      const msg = sentMessages[0].html;
      expect(msg).toContain('Top spending categories');
      expect(msg).toContain('Food & Dining');
      expect(msg).toContain('Housing');
    });

    it('includes month-over-month comparison when available', async () => {
      mockGetSpendingSummary
        .mockReturnValueOnce({ summary: [{ income: 10000, expense: 8000 }], groupBy: 'cashflow' })
        .mockReturnValueOnce({ summary: [], groupBy: 'category' });

      // change_percent < 0 means "less" spending, > 0 means "more" spending
      mockComparePeriods.mockReturnValue({
        comparison: [],
        summary: {
          period1: { total: -7000 },
          period2: { total: -8000 },
          change_amount: -1000,
          change_percent: -14,
        },
      });

      await sendMonthlySummary();

      const msg = sentMessages[0].html;
      expect(msg).toContain('14%');
      expect(msg).toContain('less');
    });
  });

  // ── checkReviewNeeded ──

  describe('checkReviewNeeded', () => {
    it('sends alert when there are transactions needing review', async () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { needsReview: true });
      insertTransaction(testDb.db, account.id, { needsReview: true });
      insertTransaction(testDb.db, account.id, { needsReview: false });

      await checkReviewNeeded();

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const msg = sentMessages[0].html;
      expect(msg).toContain('Transactions Need Review');
      expect(msg).toContain('2');
    });

    it('does not send alert when no transactions need review', async () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { needsReview: false, category: 'food' });

      await checkReviewNeeded();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('includes uncategorized transaction count', async () => {
      const account = insertAccount(testDb.db);
      insertTransaction(testDb.db, account.id, { needsReview: true, category: null });
      insertTransaction(testDb.db, account.id, { needsReview: false, category: null });

      await checkReviewNeeded();

      const msg = sentMessages[0].html;
      expect(msg).toContain('uncategorized');
    });
  });
});
