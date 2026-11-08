import cron, { type ScheduledTask } from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import { config } from '../config.js';
import { hasActiveSessions, getUniqueActiveAccounts, runScrapeSession } from './session-manager.js';
import { sendMonthlySummary } from '../telegram/alerts.js';
import { loadAlertSettings } from '../telegram/alert-settings.js';

let scheduledTask: ScheduledTask | null = null;
let monthlyTask: ScheduledTask | null = null;

/** The due occurrence advances only after admission or an explicit empty-account skip. */
let lastHandledOccurrence: Date | null = null;
let occurrence: {
  due: Date;
  status: 'pending' | 'skipped-busy' | 'skipped-empty' | 'admitted';
  sessionId?: number;
} | null = null;

function admitOccurrence(due: Date): void {
  if (lastHandledOccurrence && due <= lastHandledOccurrence) return;
  occurrence = { due, status: 'pending' };
  if (hasActiveSessions()) {
    occurrence.status = 'skipped-busy';
    return;
  }
  const accounts = getUniqueActiveAccounts();
  if (!accounts.length) {
    occurrence.status = 'skipped-empty';
    lastHandledOccurrence = due;
    return;
  }
  try {
    const { session } = runScrapeSession('scheduled', accounts);
    occurrence = { due, status: 'admitted', sessionId: session.id };
    lastHandledOccurrence = due;
    console.log(`[Scheduler] Admitted occurrence ${due.toISOString()} as session ${session.id}`);
  } catch (cause) {
    console.warn(
      '[Scheduler] Occurrence remains pending:',
      cause instanceof Error ? cause.message : cause,
    );
  }
}
function mostRecentOccurrence(): Date {
  return CronExpressionParser.parse(config.SCRAPE_CRON, {
    tz: config.SCRAPE_TIMEZONE,
    currentDate: new Date(Date.now() + 1),
  })
    .prev()
    .toDate();
}

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

  if (!lastHandledOccurrence) {
    lastHandledOccurrence = new Date();
  }

  scheduledTask = cron.schedule(
    cronExpression,
    () => {
      admitOccurrence(mostRecentOccurrence());
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

/** Revisit a due occurrence after wake; a busy skip never claims it was admitted. */
export function checkAndRunMissedScrape(): void {
  if (!lastHandledOccurrence || !scheduledTask) return;
  try {
    const due = mostRecentOccurrence();
    // Retain a pending occurrence when the configured schedule changes during sleep.
    admitOccurrence(
      occurrence && occurrence.status === 'pending' && occurrence.due > due ? occurrence.due : due,
    );
  } catch (cause) {
    console.error(
      '[Scheduler] Failed to check missed scrapes:',
      cause instanceof Error ? cause.message : cause,
    );
  }
}
