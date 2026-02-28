import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts, scrapeSessions } from '../db/schema.js';
import type { Account, ScrapeSession } from '../shared/types.js';
import { scrapeAccount } from './scraper.service.js';
import { broadcastSseEvent } from '../api/sse.js';

interface ActiveSession {
  session: ScrapeSession;
  abortController: AbortController;
  /** Promise that resolves when the session completes */
  promise: Promise<void>;
}

const activeSessions = new Map<number, ActiveSession>();

export function getActiveSessions(): ActiveSession[] {
  return Array.from(activeSessions.values());
}

export function getActiveSession(sessionId: number): ActiveSession | undefined {
  return activeSessions.get(sessionId);
}

export function createSession(trigger: 'manual' | 'scheduled' | 'single', accountIds: number[]): { session: ScrapeSession; abortController: AbortController } {
  const session = db.insert(scrapeSessions).values({
    trigger,
    status: 'running',
    accountIds: JSON.stringify(accountIds),
    startedAt: new Date().toISOString(),
  }).returning().get();

  const abortController = new AbortController();
  return { session, abortController };
}

export function registerActiveSession(session: ScrapeSession, abortController: AbortController, promise: Promise<void>): void {
  activeSessions.set(session.id, { session, abortController, promise });
}

export function completeSession(sessionId: number, status: 'completed' | 'error' | 'cancelled'): void {
  db.update(scrapeSessions)
    .set({ status, completedAt: new Date().toISOString() })
    .where(eq(scrapeSessions.id, sessionId))
    .run();
  activeSessions.delete(sessionId);
}

export function cancelSession(sessionId: number): boolean {
  const active = activeSessions.get(sessionId);
  if (!active) return false;

  active.abortController.abort();
  db.update(scrapeSessions)
    .set({ status: 'cancelled', completedAt: new Date().toISOString() })
    .where(eq(scrapeSessions.id, sessionId))
    .run();
  activeSessions.delete(sessionId);
  return true;
}

export function hasActiveSessions(): boolean {
  return activeSessions.size > 0;
}

export function getUniqueActiveAccounts(): Account[] {
  const activeAccounts = db.select().from(accounts).where(eq(accounts.isActive, true)).all();
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
  const accountIds = accountsToScrape.map(a => a.id);
  const { session, abortController } = createSession(trigger, accountIds);
  broadcastSseEvent({ type: 'session-started', sessionId: session.id, accountIds, trigger });

  const promise = (async () => {
    try {
      let hasError = false;
      for (const account of accountsToScrape) {
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
      completeSession(session.id, finalStatus);
      broadcastSseEvent({ type: 'session-completed', sessionId: session.id, status: finalStatus });
    } catch {
      completeSession(session.id, 'error');
      broadcastSseEvent({ type: 'session-completed', sessionId: session.id, status: 'error' });
    }
  })();

  registerActiveSession(session, abortController, promise);
  return { session };
}
