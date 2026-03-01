import type { FastifyInstance } from 'fastify';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts, scrapeLogs, scrapeSessions } from '../db/schema.js';
import { scrapeLogsQuerySchema, scrapeSessionsQuerySchema, otpSubmitSchema } from './validation.js';
import { parseIntParam, validateBody, validateQuery } from './helpers.js';
import { addSseClient, removeSseClient, broadcastSseEvent } from './sse.js';
import { submitOtp } from '../scraper/otp-bridge.js';
import { confirmManualAction } from '../scraper/manual-action-bridge.js';
import { cancelSession, hasActiveSessions, getActiveSessions, getUniqueActiveAccounts, runScrapeSession } from '../scraper/session-manager.js';
import type { ScrapeLog } from '../shared/types.js';

function enrichLogsWithAccountNames(logs: ScrapeLog[]) {
  const allAccounts = db.select({ id: accounts.id, displayName: accounts.displayName, companyId: accounts.companyId })
    .from(accounts).all();
  const accountMap = new Map(allAccounts.map(a => [a.id, a]));
  return logs.map(log => {
    const account = accountMap.get(log.accountId);
    return { ...log, accountName: account?.displayName ?? 'Unknown', companyId: account?.companyId ?? '' };
  });
}

export async function scrapeRoutes(app: FastifyInstance) {

  // ─── SSE endpoint ───

  app.get('/api/scrape/events', (request, reply) => {
    reply.hijack();
    const res = reply.raw;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send connected event only to this client
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
    addSseClient(res);

    const heartbeat = setInterval(() => {
      res.write(':\n\n');
    }, 30_000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      removeSseClient(res);
    });
  });

  // ─── OTP submit ───

  app.post('/api/scrape/otp', async (request, reply) => {
    const data = validateBody(otpSubmitSchema, request.body, reply);
    if (!data) return;

    const { accountId, code } = data;
    const accepted = submitOtp(accountId, code);

    if (!accepted) {
      return reply.status(404).send({ error: 'No pending OTP request for this account' });
    }

    return reply.send({ success: true });
  });

  // ─── Manual login confirm ───

  app.post<{ Params: { accountId: string } }>('/api/scrape/manual-confirm/:accountId', async (request, reply) => {
    const accountId = parseIntParam(request.params.accountId, 'account ID', reply);
    if (accountId === null) return;

    const accepted = confirmManualAction(accountId);
    if (!accepted) {
      return reply.status(404).send({ error: 'No pending manual login for this account' });
    }

    return reply.send({ success: true });
  });

  // ─── Scrape single account (fire-and-forget) ───

  app.post<{ Params: { accountId: string } }>('/api/scrape/:accountId', async (request, reply) => {
    const accountId = parseIntParam(request.params.accountId, 'account ID', reply);
    if (accountId === null) return;

    const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
    if (!account) return reply.status(404).send({ error: 'Account not found' });

    if (hasActiveSessions()) {
      return reply.status(429).send({ error: 'A scrape is already in progress' });
    }

    const { session } = runScrapeSession('single', [account]);
    return reply.status(202).send({ sessionId: session.id });
  });

  // ─── Scrape all accounts (fire-and-forget) ───

  app.post('/api/scrape/all', async (_request, reply) => {
    if (hasActiveSessions()) {
      return reply.status(429).send({ error: 'A scrape is already in progress' });
    }

    const uniqueAccounts = getUniqueActiveAccounts();
    const { session } = runScrapeSession('manual', uniqueAccounts);
    return reply.status(202).send({ sessionId: session.id });
  });

  // ─── Cancel session ───

  app.post<{ Params: { sessionId: string } }>('/api/scrape/cancel/:sessionId', async (request, reply) => {
    const sessionId = parseIntParam(request.params.sessionId, 'session ID', reply);
    if (sessionId === null) return;

    const cancelled = cancelSession(sessionId);
    if (!cancelled) return reply.status(404).send({ error: 'No active session found' });

    broadcastSseEvent({ type: 'session-completed', sessionId, status: 'cancelled' });
    return reply.send({ success: true });
  });

  // ─── List sessions ───

  app.get('/api/scrape/sessions', async (request, reply) => {
    const data = validateQuery(scrapeSessionsQuerySchema, request.query, reply);
    if (!data) return;
    const { limit, offset } = data;

    const sessions = db.select().from(scrapeSessions)
      .orderBy(desc(scrapeSessions.startedAt))
      .limit(limit)
      .offset(offset)
      .all();

    const sessionsWithLogs = sessions.map(session => {
      const logs = db.select().from(scrapeLogs)
        .where(eq(scrapeLogs.sessionId, session.id))
        .all();
      return { ...session, logs: enrichLogsWithAccountNames(logs) };
    });

    const activeSessionsList = getActiveSessions().map(a => ({
      ...a.session,
      logs: [],
    }));

    return reply.send({ sessions: sessionsWithLogs, activeSessions: activeSessionsList });
  });

  // ─── Single session detail ───

  app.get<{ Params: { id: string } }>('/api/scrape/sessions/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'session ID', reply);
    if (id === null) return;

    const session = db.select().from(scrapeSessions).where(eq(scrapeSessions.id, id)).get();
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    const logs = db.select().from(scrapeLogs)
      .where(eq(scrapeLogs.sessionId, id))
      .all();

    return reply.send({ session: { ...session, logs: enrichLogsWithAccountNames(logs) } });
  });

  // ─── Scrape logs ───

  app.get('/api/scrape/logs', async (request, reply) => {
    const data = validateQuery(scrapeLogsQuerySchema, request.query, reply);
    if (!data) return;
    const { accountId, limit } = data;

    let logs;
    if (accountId !== undefined) {
      logs = db.select().from(scrapeLogs)
        .where(eq(scrapeLogs.accountId, accountId))
        .orderBy(desc(scrapeLogs.startedAt))
        .limit(limit)
        .all();
    } else {
      logs = db.select().from(scrapeLogs)
        .orderBy(desc(scrapeLogs.startedAt))
        .limit(limit)
        .all();
    }

    return reply.send({ logs });
  });
}
