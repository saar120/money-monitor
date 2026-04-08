import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts, transactions, scrapeLogs } from '../db/schema.js';
import { setCredentials, deleteCredentials } from '../scraper/credential-store.js';
import { randomUUID } from 'node:crypto';
import { createAccountSchema, updateAccountSchema } from './validation.js';
import { parseIntParam, validateBody } from './helpers.js';
import { getAccountType } from '../shared/types.js';
import type { CompanyId } from '../shared/types.js';
import { MANUAL_LOGIN_COMPANIES } from '../scraper/scraper.service.js';

function stripCredentialsRef(account: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { credentialsRef, ...safe } = account;
  return safe;
}

export async function accountsRoutes(app: FastifyInstance) {
  app.get('/api/accounts', async (_request, reply) => {
    const rows = db.select().from(accounts).all();
    return reply.send({ accounts: rows.map(stripCredentialsRef) });
  });

  app.post('/api/accounts', async (request, reply) => {
    const data = validateBody(createAccountSchema, request.body, reply);
    if (!data) return;
    const { companyId, displayName, credentials } = data;

    const credentialsRef = randomUUID();
    setCredentials(credentialsRef, credentials);

    const isManualLoginCompany = MANUAL_LOGIN_COMPANIES.has(companyId);
    const result = db
      .insert(accounts)
      .values({
        companyId,
        displayName,
        credentialsRef,
        accountType: getAccountType(companyId as CompanyId),
        manualLogin: isManualLoginCompany,
        showBrowser: isManualLoginCompany,
      })
      .returning()
      .get();

    return reply.status(201).send({ account: stripCredentialsRef(result) });
  });

  app.put<{ Params: { id: string } }>('/api/accounts/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'account ID', reply);
    if (id === null) return;

    const existing = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!existing) return reply.status(404).send({ error: 'Account not found' });

    const data = validateBody(updateAccountSchema, request.body, reply);
    if (!data) return;
    const {
      displayName,
      isActive,
      manualLogin,
      showBrowser,
      manualScrapeOnly,
      stalenessDays,
      credentials,
    } = data;

    if (credentials && Object.keys(credentials).length > 0) {
      setCredentials(existing.credentialsRef, credentials);
    }

    const updateSet: Record<string, unknown> = {};
    if (displayName !== undefined) updateSet.displayName = displayName;
    if (isActive !== undefined) updateSet.isActive = isActive;
    if (manualLogin !== undefined) updateSet.manualLogin = manualLogin;
    if (showBrowser !== undefined) updateSet.showBrowser = showBrowser;
    if (manualScrapeOnly !== undefined) updateSet.manualScrapeOnly = manualScrapeOnly;
    if (stalenessDays !== undefined) updateSet.stalenessDays = stalenessDays;

    if (Object.keys(updateSet).length > 0) {
      db.update(accounts).set(updateSet).where(eq(accounts.id, id)).run();
    }

    const updated = db.select().from(accounts).where(eq(accounts.id, id)).get();
    return reply.send({ account: updated ? stripCredentialsRef(updated) : null });
  });

  app.delete<{
    Params: { id: string };
    Querystring: { deleteTransactions?: string };
  }>('/api/accounts/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'account ID', reply);
    if (id === null) return;

    const existing = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!existing) return reply.status(404).send({ error: 'Account not found' });

    // Only delete credentials if no other account shares them
    const siblings = db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.credentialsRef, existing.credentialsRef))
      .all();

    if (siblings.length <= 1) {
      deleteCredentials(existing.credentialsRef);
    }

    db.delete(scrapeLogs).where(eq(scrapeLogs.accountId, id)).run();

    if (request.query.deleteTransactions === 'true') {
      db.delete(transactions).where(eq(transactions.accountId, id)).run();
    }

    db.delete(accounts).where(eq(accounts.id, id)).run();

    return reply.send({ deleted: true, id });
  });
}
