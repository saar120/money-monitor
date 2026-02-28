import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { scrapeSessions } from '../db/schema.js';
import type { ScrapeSession } from '../shared/types.js';

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

export function completeSession(sessionId: number, status: 'completed' | 'error'): void {
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
