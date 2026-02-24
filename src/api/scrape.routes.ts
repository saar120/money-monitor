import type { FastifyInstance } from 'fastify';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts, scrapeLogs } from '../db/schema.js';
import { scrapeAccount, scrapeAllAccounts } from '../scraper/scraper.service.js';
import { scrapeLogsQuerySchema } from './validation.js';

const activeScrapes = new Set<number | 'all'>();

export async function scrapeRoutes(app: FastifyInstance) {

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
    try {
      const result = await scrapeAccount(account);
      return reply.status(result.success ? 200 : 500).send(result);
    } finally {
      activeScrapes.delete(accountId);
    }
  });

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
