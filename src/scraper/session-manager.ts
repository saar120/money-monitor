import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts, scrapeSessions } from '../db/schema.js';
import type { Account, ScrapeSession } from '../shared/types.js';
import { scrapeAccount } from './scraper.service.js';
import type { ScrapeResult } from './scraper.service.js';
import { broadcastSseEvent } from '../api/sse.js';
import { enqueuePostImport, runPostImport } from '../services/post-import.js';

interface ActiveSession {
  session: ScrapeSession;
  abortController: AbortController;
  /** Promise that resolves when the session completes */
  promise: Promise<void>;
  revision: number;
}

const activeSessions = new Map<number, ActiveSession>();

export function getActiveSessions(): ActiveSession[] {
  return Array.from(activeSessions.values());
}

export function getActiveSession(sessionId: number): ActiveSession | undefined {
  return activeSessions.get(sessionId);
}

export function createSession(
  trigger: 'manual' | 'scheduled' | 'single',
  accountIds: number[],
): { session: ScrapeSession; abortController: AbortController } {
  const session = db
    .insert(scrapeSessions)
    .values({
      trigger,
      status: 'running',
      accountIds: JSON.stringify(accountIds),
      startedAt: new Date().toISOString(),
    })
    .returning()
    .get();

  const abortController = new AbortController();
  return { session, abortController };
}

export function registerActiveSession(
  session: ScrapeSession,
  abortController: AbortController,
  promise: Promise<void>,
): void {
  activeSessions.set(session.id, { session, abortController, promise, revision: 1 });
}

export function completeSession(
  sessionId: number,
  status: 'completed' | 'error' | 'cancelled',
): void {
  const active = activeSessions.get(sessionId);
  if (active?.abortController.signal.aborted) status = 'cancelled';
  db.update(scrapeSessions)
    .set({ status, completedAt: new Date().toISOString() })
    .where(eq(scrapeSessions.id, sessionId))
    .run();
  activeSessions.delete(sessionId);
}

export function cancelSession(sessionId: number): boolean {
  const active = activeSessions.get(sessionId);
  if (!active) return false;

  active.session.status = 'cancelling';
  active.revision++;
  active.abortController.abort();
  db.update(scrapeSessions)
    .set({ status: 'cancelling' })
    .where(eq(scrapeSessions.id, sessionId))
    .run();
  broadcastSseEvent({
    type: 'session-updated',
    sessionId,
    status: 'cancelling',
    revision: active.revision,
  });
  return true;
}

export function hasActiveSessions(): boolean {
  return activeSessions.size > 0;
}

export function getUniqueActiveAccounts(): Account[] {
  const activeAccounts = db
    .select()
    .from(accounts)
    .where(and(eq(accounts.isActive, true), eq(accounts.manualScrapeOnly, false)))
    .all();
  const seen = new Set<string>();
  const unique: Account[] = [];
  for (const account of activeAccounts) {
    if (!seen.has(account.credentialsRef)) {
      seen.add(account.credentialsRef);
      unique.push(account);
    }
  }
  return unique;
}

export function runScrapeSession(
  trigger: 'manual' | 'scheduled' | 'single',
  accountsToScrape: Account[],
): { session: ScrapeSession } {
  if (hasActiveSessions() || !accepting)
    throw new Error('A scrape is already in progress or admission is paused');
  const accountIds = accountsToScrape.map((a) => a.id);
  const { session, abortController } = createSession(trigger, accountIds);
  broadcastSseEvent({ type: 'session-started', sessionId: session.id, accountIds, trigger });

  const promise = Promise.resolve().then(async () => {
    const allResults: ScrapeResult[] = [];
    const categorizePending: Promise<void>[] = [];
    try {
      let hasError = false;
      for (const account of accountsToScrape) {
        if (abortController.signal.aborted) break;
        broadcastSseEvent({
          type: 'account-scrape-started',
          sessionId: session.id,
          accountId: account.id,
        });
        const { results, categorizePending: pending } = await scrapeAccount(
          account,
          session.id,
          abortController.signal,
        );
        if (pending) categorizePending.push(pending);
        for (const result of results) {
          allResults.push(result);
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
      const active = activeSessions.get(session.id);
      if (active && !abortController.signal.aborted) {
        active.session.status = 'finalizing';
        broadcastSseEvent({
          type: 'session-updated',
          sessionId: session.id,
          status: 'finalizing',
          revision: ++active.revision,
        });
      }
      const enrichment = await Promise.allSettled(categorizePending);
      if (enrichment.some((result) => result.status === 'rejected')) hasError = true;
      if (!abortController.signal.aborted && allResults.length) {
        const notificationJob = enqueuePostImport(
          `scrape-session:${session.id}:alerts`,
          [],
          allResults,
        );
        await runPostImport(notificationJob, abortController.signal);
      }
      const finalStatus = abortController.signal.aborted
        ? 'cancelled'
        : hasError
          ? 'error'
          : 'completed';
      completeSession(session.id, finalStatus);
      broadcastSseEvent({ type: 'session-completed', sessionId: session.id, status: finalStatus });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[Scrape] Session ${session.id} failed:`, errorMessage);
      await Promise.allSettled(categorizePending);
      const status = abortController.signal.aborted ? 'cancelled' : 'error';
      completeSession(session.id, status);
      broadcastSseEvent({
        type: 'session-completed',
        sessionId: session.id,
        status,
        error: errorMessage,
      });
    } finally {
      await Promise.allSettled(categorizePending);
      activeSessions.delete(session.id);
    }
  });

  registerActiveSession(session, abortController, promise);
  return { session };
}

let accepting = true;
export function pauseScrapeAdmission() {
  accepting = false;
}
export function resumeScrapeAdmission() {
  accepting = true;
}
export async function drainScrapeSessions(cancel = true) {
  const sessions = getActiveSessions();
  if (cancel) for (const active of sessions) cancelSession(active.session.id);
  await Promise.allSettled(sessions.map((active) => active.promise));
}
export function recoverInterruptedScrapes() {
  db.update(scrapeSessions)
    .set({ status: 'interrupted', completedAt: new Date().toISOString() })
    .where(inArray(scrapeSessions.status, ['running', 'cancelling', 'finalizing']))
    .run();
}
