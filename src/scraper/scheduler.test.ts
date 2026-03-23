import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Unmock the scheduler (global setup.ts mocks it out entirely)
vi.unmock('./scheduler.js');

// Mock node-cron so startScheduler doesn't create real cron tasks
vi.mock('node-cron', () => ({
  default: {
    validate: vi.fn(() => true),
    schedule: vi.fn(() => ({ stop: vi.fn() })),
  },
}));

vi.mock('./session-manager.js', () => ({
  hasActiveSessions: vi.fn(() => false),
  getUniqueActiveAccounts: vi.fn(() => [{ id: 1 }]),
  runScrapeSession: vi.fn(() => ({ session: { id: 'test-session' } })),
}));

vi.mock('../telegram/alerts.js', () => ({
  sendMonthlySummary: vi.fn(),
}));

vi.mock('../telegram/alert-settings.js', () => ({
  loadAlertSettings: vi.fn(() => ({ monthlySummary: { dayOfMonth: 1 } })),
}));

// vi.mock factories are cached (run once), so all tests share the same mock
// function instances. Import them once here for assertions and return-value resets.
import { hasActiveSessions, getUniqueActiveAccounts, runScrapeSession } from './session-manager.js';

// March 15, 2026: Israel is on IST (UTC+2), DST starts March 27.
// Cron is "0 6 * * *" Asia/Jerusalem → 06:00 Jerusalem = 04:00 UTC.

describe('checkAndRunMissedScrape', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset scheduler.ts module state (lastCronFireTime, scheduledTask, etc.)
    vi.resetModules();
    // Clear call counts and restore default return values on shared mock fns
    vi.mocked(hasActiveSessions).mockReset().mockReturnValue(false);

    vi.mocked(getUniqueActiveAccounts)
      .mockReset()
      .mockReturnValue([{ id: 1 }] as any);

    vi.mocked(runScrapeSession)
      .mockReset()
      .mockReturnValue({ session: { id: 'test-session' } } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('triggers a scrape when a cron tick was missed during sleep', async () => {
    // 05:00 Jerusalem (03:00 UTC) — before the 06:00 cron
    vi.setSystemTime(new Date('2026-03-15T03:00:00.000Z'));

    const { startScheduler, stopScheduler, checkAndRunMissedScrape } =
      await import('./scheduler.js');

    startScheduler(); // sets lastCronFireTime to 05:00 Jerusalem

    // Simulate waking up at 10:00 Jerusalem (08:00 UTC) — cron at 06:00 was missed
    vi.setSystemTime(new Date('2026-03-15T08:00:00.000Z'));

    checkAndRunMissedScrape();

    expect(runScrapeSession).toHaveBeenCalledWith('scheduled', expect.any(Array));

    stopScheduler();
  });

  it('does not trigger when no cron tick was missed', async () => {
    // 06:05 Jerusalem (04:05 UTC) — just after the 06:00 cron
    vi.setSystemTime(new Date('2026-03-15T04:05:00.000Z'));

    const { startScheduler, stopScheduler, checkAndRunMissedScrape } =
      await import('./scheduler.js');

    startScheduler(); // sets lastCronFireTime to 06:05 Jerusalem

    // Short sleep — wake at 06:30 Jerusalem, no tick missed
    vi.setSystemTime(new Date('2026-03-15T04:30:00.000Z'));

    checkAndRunMissedScrape();

    expect(runScrapeSession).not.toHaveBeenCalled();

    stopScheduler();
  });

  it('skips when a scrape is already in progress', async () => {
    vi.setSystemTime(new Date('2026-03-15T03:00:00.000Z'));

    const { startScheduler, stopScheduler, checkAndRunMissedScrape } =
      await import('./scheduler.js');

    startScheduler();

    vi.mocked(hasActiveSessions).mockReturnValue(true);
    vi.setSystemTime(new Date('2026-03-15T08:00:00.000Z'));

    checkAndRunMissedScrape();

    expect(runScrapeSession).not.toHaveBeenCalled();

    stopScheduler();
  });

  it('skips when there are no active accounts', async () => {
    vi.setSystemTime(new Date('2026-03-15T03:00:00.000Z'));

    const { startScheduler, stopScheduler, checkAndRunMissedScrape } =
      await import('./scheduler.js');

    startScheduler();

    vi.mocked(getUniqueActiveAccounts).mockReturnValue([]);
    vi.setSystemTime(new Date('2026-03-15T08:00:00.000Z'));

    checkAndRunMissedScrape();

    expect(runScrapeSession).not.toHaveBeenCalled();

    stopScheduler();
  });

  it('does not trigger a second scrape on a subsequent wakeup for the same missed tick', async () => {
    // 05:00 Jerusalem (03:00 UTC) — before the 06:00 cron
    vi.setSystemTime(new Date('2026-03-15T03:00:00.000Z'));

    const { startScheduler, stopScheduler, checkAndRunMissedScrape } =
      await import('./scheduler.js');

    startScheduler();

    // First wakeup at 10:00 Jerusalem (08:00 UTC) — cron at 06:00 was missed
    vi.setSystemTime(new Date('2026-03-15T08:00:00.000Z'));
    checkAndRunMissedScrape();
    expect(runScrapeSession).toHaveBeenCalledTimes(1);

    // Simulate the onResume pattern: stop + start scheduler
    stopScheduler();
    startScheduler();

    // Second wakeup at 11:00 Jerusalem (09:00 UTC) — same day, no new missed tick
    vi.setSystemTime(new Date('2026-03-15T09:00:00.000Z'));
    checkAndRunMissedScrape();
    expect(runScrapeSession).toHaveBeenCalledTimes(1); // should NOT scrape again

    stopScheduler();
  });

  it('does nothing before scheduler has started (lastCronFireTime is null)', async () => {
    const { checkAndRunMissedScrape } = await import('./scheduler.js');

    checkAndRunMissedScrape();

    expect(runScrapeSession).not.toHaveBeenCalled();
  });
});
