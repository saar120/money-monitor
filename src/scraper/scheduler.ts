import cron, { type ScheduledTask } from 'node-cron';
import { config } from '../config.js';
import { hasActiveSessions, getUniqueActiveAccounts, runScrapeSession } from './session-manager.js';

let scheduledTask: ScheduledTask | null = null;

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

  scheduledTask = cron.schedule(cronExpression, async () => {
    console.log(`[Scheduler] Triggered at ${new Date().toISOString()}`);

    if (hasActiveSessions()) {
      console.log('[Scheduler] Skipping — a scrape is already in progress');
      return;
    }

    const uniqueAccounts = getUniqueActiveAccounts();
    const { session } = runScrapeSession('scheduled', uniqueAccounts);
    console.log(`[Scheduler] Started session ${session.id}`);
  }, { timezone });
}

export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('[Scheduler] Stopped');
  }
}
