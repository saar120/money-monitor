import cron, { type ScheduledTask } from 'node-cron';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/connection.js';
import { accounts } from '../db/schema.js';
import { scrapeAccount } from './scraper.service.js';
import { createSession, registerActiveSession, completeSession, hasActiveSessions } from './session-manager.js';
import { broadcastSseEvent } from '../api/sse.js';
import type { Account } from '../shared/types.js';

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

    const activeAccounts = db.select().from(accounts).where(eq(accounts.isActive, true)).all();
    const seen = new Set<string>();
    const uniqueAccounts: Account[] = [];
    for (const account of activeAccounts) {
      if (!seen.has(account.credentialsRef)) {
        seen.add(account.credentialsRef);
        uniqueAccounts.push(account);
      }
    }

    const accountIds = uniqueAccounts.map(a => a.id);
    const { session, abortController } = createSession('scheduled', accountIds);
    broadcastSseEvent({ type: 'session-started', sessionId: session.id, accountIds, trigger: 'scheduled' });

    const promise = (async () => {
      let hasError = false;
      for (const account of uniqueAccounts) {
        if (abortController.signal.aborted) break;
        broadcastSseEvent({ type: 'account-scrape-started', sessionId: session.id, accountId: account.id });
        const results = await scrapeAccount(account, session.id, abortController.signal);
        for (const result of results) {
          if (!result.success) hasError = true;
          broadcastSseEvent({
            type: result.success ? 'account-scrape-done' : 'account-scrape-error',
            sessionId: session.id,
            accountId: result.accountId,
            transactionsFound: result.transactionsFound,
            transactionsNew: result.transactionsNew,
            durationMs: result.durationMs,
            error: result.error,
            errorType: result.errorType,
          });
        }
      }
      const finalStatus = abortController.signal.aborted ? 'cancelled' : hasError ? 'error' : 'completed';
      completeSession(session.id, finalStatus as 'completed' | 'error');
      broadcastSseEvent({ type: 'session-completed', sessionId: session.id, status: finalStatus });
      console.log(`[Scheduler] Session ${session.id} ${finalStatus}`);
    })();

    registerActiveSession(session, abortController, promise);
  }, { timezone });
}

export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('[Scheduler] Stopped');
  }
}
