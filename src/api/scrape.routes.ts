import type { FastifyInstance } from 'fastify';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts, scrapeLogs, scrapeSessions } from '../db/schema.js';
import { scrapeAccount } from '../scraper/scraper.service.js';
import { scrapeLogsQuerySchema, scrapeSessionsQuerySchema, otpSubmitSchema } from './validation.js';
import { addSseClient, removeSseClient, broadcastSseEvent } from './sse.js';
import { submitOtp } from '../scraper/otp-bridge.js';
import { confirmManualAction } from '../scraper/manual-action-bridge.js';
import { createSession, registerActiveSession, completeSession, cancelSession, hasActiveSessions, getActiveSessions } from '../scraper/session-manager.js';
import type { Account } from '../shared/types.js';

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
    const parsed = otpSubmitSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { accountId, code } = parsed.data;
    const accepted = submitOtp(accountId, code);

    if (!accepted) {
      return reply.status(404).send({ error: 'No pending OTP request for this account' });
    }

    return reply.send({ success: true });
  });

  // ─── Manual login confirm ───

  app.post<{ Params: { accountId: string } }>('/api/scrape/manual-confirm/:accountId', async (request, reply) => {
    const accountId = parseInt(request.params.accountId, 10);
    if (isNaN(accountId)) {
      return reply.status(400).send({ error: 'Invalid account ID' });
    }

    const accepted = confirmManualAction(accountId);
    if (!accepted) {
      return reply.status(404).send({ error: 'No pending manual login for this account' });
    }

    return reply.send({ success: true });
  });

  // ─── Scrape single account (fire-and-forget) ───

  app.post<{ Params: { accountId: string } }>('/api/scrape/:accountId', async (request, reply) => {
    const accountId = parseInt(request.params.accountId, 10);
    if (isNaN(accountId)) return reply.status(400).send({ error: 'Invalid account ID' });

    const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
    if (!account) return reply.status(404).send({ error: 'Account not found' });

    if (hasActiveSessions()) {
      return reply.status(429).send({ error: 'A scrape is already in progress' });
    }

    const { session, abortController } = createSession('single', [accountId]);

    broadcastSseEvent({ type: 'session-started', sessionId: session.id, accountIds: [accountId], trigger: 'single' });
    broadcastSseEvent({ type: 'account-scrape-started', sessionId: session.id, accountId });

    const promise = scrapeAccount(account, session.id, abortController.signal)
      .then((result) => {
        broadcastSseEvent({
          type: result.success ? 'account-scrape-done' : 'account-scrape-error',
          sessionId: session.id,
          accountId,
          transactionsFound: result.transactionsFound,
          transactionsNew: result.transactionsNew,
          durationMs: result.durationMs,
          error: result.error,
          errorType: result.errorType,
        });
        completeSession(session.id, result.success ? 'completed' : 'error');
        broadcastSseEvent({ type: 'session-completed', sessionId: session.id, status: result.success ? 'completed' : 'error' });
      })
      .catch(() => {
        completeSession(session.id, 'error');
        broadcastSseEvent({ type: 'session-completed', sessionId: session.id, status: 'error' });
      });

    registerActiveSession(session, abortController, promise);
    return reply.status(202).send({ sessionId: session.id });
  });

  // ─── Scrape all accounts (fire-and-forget) ───

  app.post('/api/scrape/all', async (_request, reply) => {
    if (hasActiveSessions()) {
      return reply.status(429).send({ error: 'A scrape is already in progress' });
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
    const { session, abortController } = createSession('manual', accountIds);

    broadcastSseEvent({ type: 'session-started', sessionId: session.id, accountIds, trigger: 'manual' });

    const promise = (async () => {
      let hasError = false;
      for (const account of uniqueAccounts) {
        if (abortController.signal.aborted) break;
        broadcastSseEvent({ type: 'account-scrape-started', sessionId: session.id, accountId: account.id });
        const result = await scrapeAccount(account, session.id, abortController.signal);
        if (!result.success) hasError = true;
        broadcastSseEvent({
          type: result.success ? 'account-scrape-done' : 'account-scrape-error',
          sessionId: session.id,
          accountId: account.id,
          transactionsFound: result.transactionsFound,
          transactionsNew: result.transactionsNew,
          durationMs: result.durationMs,
          error: result.error,
          errorType: result.errorType,
        });
      }
      const finalStatus = abortController.signal.aborted ? 'cancelled' : hasError ? 'error' : 'completed';
      completeSession(session.id, finalStatus as 'completed' | 'error');
      broadcastSseEvent({ type: 'session-completed', sessionId: session.id, status: finalStatus });
    })();

    registerActiveSession(session, abortController, promise);
    return reply.status(202).send({ sessionId: session.id });
  });

  // ─── Cancel session ───

  app.post<{ Params: { sessionId: string } }>('/api/scrape/cancel/:sessionId', async (request, reply) => {
    const sessionId = parseInt(request.params.sessionId, 10);
    if (isNaN(sessionId)) return reply.status(400).send({ error: 'Invalid session ID' });

    const cancelled = cancelSession(sessionId);
    if (!cancelled) return reply.status(404).send({ error: 'No active session found' });

    broadcastSseEvent({ type: 'session-completed', sessionId, status: 'cancelled' });
    return reply.send({ success: true });
  });

  // ─── List sessions ───

  app.get('/api/scrape/sessions', async (request, reply) => {
    const parsed = scrapeSessionsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
    }
    const { limit, offset } = parsed.data;

    const sessions = db.select().from(scrapeSessions)
      .orderBy(desc(scrapeSessions.startedAt))
      .limit(limit)
      .offset(offset)
      .all();

    const sessionsWithLogs = sessions.map(session => {
      const logs = db.select().from(scrapeLogs)
        .where(eq(scrapeLogs.sessionId, session.id))
        .all();

      const logsWithNames = logs.map(log => {
        const account = db.select({ displayName: accounts.displayName, companyId: accounts.companyId })
          .from(accounts)
          .where(eq(accounts.id, log.accountId))
          .get();
        return { ...log, accountName: account?.displayName ?? 'Unknown', companyId: account?.companyId ?? '' };
      });

      return { ...session, logs: logsWithNames };
    });

    const activeSessionsList = getActiveSessions().map(a => ({
      ...a.session,
      logs: [],
    }));

    return reply.send({ sessions: sessionsWithLogs, activeSessions: activeSessionsList });
  });

  // ─── Single session detail ───

  app.get<{ Params: { id: string } }>('/api/scrape/sessions/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid session ID' });

    const session = db.select().from(scrapeSessions).where(eq(scrapeSessions.id, id)).get();
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    const logs = db.select().from(scrapeLogs)
      .where(eq(scrapeLogs.sessionId, id))
      .all();

    const logsWithNames = logs.map(log => {
      const account = db.select({ displayName: accounts.displayName, companyId: accounts.companyId })
        .from(accounts)
        .where(eq(accounts.id, log.accountId))
        .get();
      return { ...log, accountName: account?.displayName ?? 'Unknown', companyId: account?.companyId ?? '' };
    });

    return reply.send({ session: { ...session, logs: logsWithNames } });
  });

  // ─── Scrape logs ───

  app.get('/api/scrape/logs', async (request, reply) => {
    const parsed = scrapeLogsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const { accountId, limit } = parsed.data;

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
