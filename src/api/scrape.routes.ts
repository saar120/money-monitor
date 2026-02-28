import type { FastifyInstance } from 'fastify';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts, scrapeLogs } from '../db/schema.js';
import { scrapeAccount, scrapeAllAccounts } from '../scraper/scraper.service.js';
import { scrapeLogsQuerySchema, otpSubmitSchema } from './validation.js';
import { addSseClient, removeSseClient, broadcastSseEvent } from './sse.js';
import { submitOtp } from '../scraper/otp-bridge.js';
import { confirmManualAction } from '../scraper/manual-action-bridge.js';

const activeScrapes = new Set<number | 'all'>();

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

  // ─── Scrape single account ───

  app.post<{ Params: { accountId: string } }>('/api/scrape/:accountId', async (request, reply) => {
    const accountId = parseInt(request.params.accountId, 10);
    if (isNaN(accountId)) {
      return reply.status(400).send({ error: 'Invalid account ID' });
    }

    if (activeScrapes.has(accountId) || activeScrapes.has('all')) {
      return reply.status(429).send({ error: 'A scrape is already in progress for this account' });
    }

    const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
    if (!account) {
      return reply.status(404).send({ error: 'Account not found' });
    }

    activeScrapes.add(accountId);
    broadcastSseEvent({ type: 'scrape-started', accountId });
    try {
      const result = await scrapeAccount(account);
      broadcastSseEvent({
        type: result.success ? 'scrape-done' : 'scrape-error',
        accountId,
        message: result.success ? undefined : result.error,
      });
      return reply.status(result.success ? 200 : 500).send(result);
    } finally {
      activeScrapes.delete(accountId);
    }
  });

  // ─── Scrape all accounts ───

  app.post('/api/scrape/all', async (_request, reply) => {
    if (activeScrapes.size > 0) {
      return reply.status(429).send({ error: 'A scrape is already in progress' });
    }

    activeScrapes.add('all');
    try {
      const results = await scrapeAllAccounts();
      return reply.send({ results });
    } finally {
      activeScrapes.delete('all');
    }
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
