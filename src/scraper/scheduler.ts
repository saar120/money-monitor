import cron, { type ScheduledTask } from 'node-cron';
import { config } from '../config.js';
import { scrapeAllAccounts } from './scraper.service.js';

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
    try {
      const results = await scrapeAllAccounts();
      const successes = results.filter(r => r.success).length;
      const failures = results.filter(r => !r.success).length;
      console.log(`[Scheduler] Completed: ${successes} succeeded, ${failures} failed`);
    } catch (err) {
      console.error('[Scheduler] Unhandled error during scheduled scrape:', err);
    }
  }, {
    timezone,
  });
}

export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('[Scheduler] Stopped');
  }
}
