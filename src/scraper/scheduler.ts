import cron, { type ScheduledTask } from 'node-cron';
import { config } from '../config.js';
import { hasActiveSessions, getUniqueActiveAccounts, runScrapeSession } from './session-manager.js';
import { sendMonthlySummary } from '../telegram/alerts.js';
import { loadAlertSettings } from '../telegram/alert-settings.js';

let scheduledTask: ScheduledTask | null = null;
let monthlyTask: ScheduledTask | null = null;

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

  scheduledTask = cron.schedule(
    cronExpression,
    async () => {
      console.log(`[Scheduler] Triggered at ${new Date().toISOString()}`);

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
