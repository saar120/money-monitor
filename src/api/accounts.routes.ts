import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts, transactions } from '../db/schema.js';
import { setCredentials, deleteCredentials } from '../scraper/credential-store.js';
import { COMPANY_IDS } from '../shared/types.js';
import { randomUUID } from 'node:crypto';

export async function accountsRoutes(app: FastifyInstance) {

  app.get('/api/accounts', async (_request, reply) => {
    const rows = db.select().from(accounts).all();
    return reply.send({ accounts: rows });
  });

  app.post<{
    Body: {
      companyId: string;
      displayName: string;
      credentials: Record<string, string>;
    }
  }>('/api/accounts', async (request, reply) => {
    const { companyId, displayName, credentials } = request.body;

    if (!COMPANY_IDS.includes(companyId as typeof COMPANY_IDS[number])) {
      return reply.status(400).send({
        error: `Invalid companyId. Must be one of: ${COMPANY_IDS.join(', ')}`,
      });
    }

    if (!displayName || !credentials || Object.keys(credentials).length === 0) {
      return reply.status(400).send({ error: 'displayName and credentials are required' });
    }

    const credentialsRef = randomUUID();
    setCredentials(credentialsRef, credentials);

    const result = db.insert(accounts).values({
      companyId,
      displayName,
      credentialsRef,
    }).returning().get();

    return reply.status(201).send({ account: result });
  });

  app.put<{
    Params: { id: string };
    Body: {
      displayName?: string;
      isActive?: boolean;
      credentials?: Record<string, string>;
    }
  }>('/api/accounts/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid account ID' });

    const existing = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!existing) return reply.status(404).send({ error: 'Account not found' });

    const { displayName, isActive, credentials } = request.body;

    if (credentials && Object.keys(credentials).length > 0) {
      setCredentials(existing.credentialsRef, credentials);
    }

    const updateSet: Record<string, unknown> = {};
    if (displayName !== undefined) updateSet.displayName = displayName;
    if (isActive !== undefined) updateSet.isActive = isActive;

    if (Object.keys(updateSet).length > 0) {
      db.update(accounts).set(updateSet).where(eq(accounts.id, id)).run();
    }

    const updated = db.select().from(accounts).where(eq(accounts.id, id)).get();
    return reply.send({ account: updated });
  });

  app.delete<{
    Params: { id: string };
    Querystring: { deleteTransactions?: string }
  }>('/api/accounts/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) return reply.status(400).send({ error: 'Invalid account ID' });

    const existing = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!existing) return reply.status(404).send({ error: 'Account not found' });

    deleteCredentials(existing.credentialsRef);

    if (request.query.deleteTransactions === 'true') {
      db.delete(transactions).where(eq(transactions.accountId, id)).run();
    }

    db.delete(accounts).where(eq(accounts.id, id)).run();

    return reply.send({ deleted: true, id });
  });
}
