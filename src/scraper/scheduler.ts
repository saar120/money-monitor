import cron, { type ScheduledTask } from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import { config } from '../config.js';
import { hasActiveSessions, getUniqueActiveAccounts, runScrapeSession } from './session-manager.js';
import { sendMonthlySummary } from '../telegram/alerts.js';
import { loadAlertSettings } from '../telegram/alert-settings.js';

let scheduledTask: ScheduledTask | null = null;
let monthlyTask: ScheduledTask | null = null;

/** Tracks the last time the cron callback fired (or when the scheduler started). */
let lastCronFireTime: Date | null = null;

export function startScheduler(): void {
  if (scheduledTask) {
    console.log('[Scheduler] Already running, skipping start');
    return;
  }

  const cronExpression = config.SCRAPE_CRON;
  const timezone = config.SCRAPE_TIMEZONE;

  if (!cron.validate(cronExpression)) {
    console.error(`[Scheduler] Invalid cron expression: ${cronExpression}`);
    return;
  }

  console.log(`[Scheduler] Starting with schedule "${cronExpression}" (timezone: ${timezone})`);

  if (!lastCronFireTime) {
    lastCronFireTime = new Date();
  }

  scheduledTask = cron.schedule(
    cronExpression,
    async () => {
      lastCronFireTime = new Date();
      console.log(`[Scheduler] Triggered at ${lastCronFireTime.toISOString()}`);

      if (hasActiveSessions()) {
        console.log('[Scheduler] Skipping — a scrape is already in progress');
        return;
      }

      const uniqueAccounts = getUniqueActiveAccounts();
      const { session } = runScrapeSession('scheduled', uniqueAccounts);
      console.log(`[Scheduler] Started session ${session.id}`);
    },
    { timezone },
  );

  // Monthly summary: runs daily at 9 AM, sends only on the configured day
  monthlyTask = cron.schedule(
    '0 9 * * *',
    async () => {
      const { monthlySummary } = loadAlertSettings();
      const todayDay = new Date(
        new Date().toLocaleString('en-US', { timeZone: timezone }),
      ).getDate();
      if (todayDay !== monthlySummary.dayOfMonth) return;

      console.log(`[Scheduler] Monthly summary triggered at ${new Date().toISOString()}`);
      try {
        await sendMonthlySummary();
      } catch (err) {
        console.error(
          '[Scheduler] Monthly summary failed:',
          err instanceof Error ? err.message : err,
        );
      }
    },
    { timezone },
  );
}

export function stopScheduler(): void {
  const hadTasks = scheduledTask || monthlyTask;
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
  if (monthlyTask) {
    monthlyTask.stop();
    monthlyTask = null;
  }
  if (hadTasks) {
    console.log('[Scheduler] Stopped');
  }
}

/**
 * Check if a scheduled scrape was missed during system sleep and run it if so.
 * Uses cron-parser to find the most recent occurrence of the cron schedule.
 * If that occurrence is after the last time the cron actually fired, we missed it.
 */
export function checkAndRunMissedScrape(): void {
  if (!lastCronFireTime) return;

  const cronExpression = config.SCRAPE_CRON;
  const timezone = config.SCRAPE_TIMEZONE;

  try {
    const interval = CronExpressionParser.parse(cronExpression, { tz: timezone });
    const prevOccurrence = interval.prev().toDate();

    if (prevOccurrence > lastCronFireTime) {
      console.log(
        `[Scheduler] Missed scrape detected — last fired: ${lastCronFireTime.toISOString()}, ` +
          `should have fired: ${prevOccurrence.toISOString()}`,
      );

      if (hasActiveSessions()) {
        console.log('[Scheduler] Skipping missed scrape — a scrape is already in progress');
        return;
      }

      const uniqueAccounts = getUniqueActiveAccounts();
      if (uniqueAccounts.length === 0) {
        console.log('[Scheduler] Skipping missed scrape — no active accounts');
        return;
      }

      const { session } = runScrapeSession('scheduled', uniqueAccounts);
      console.log(`[Scheduler] Started catch-up session ${session.id}`);
    } else {
      console.log('[Scheduler] No missed scrapes detected');
    }
  } catch (err) {
    console.error(
      '[Scheduler] Failed to check for missed scrapes:',
      err instanceof Error ? err.message : err,
    );
  }
}
