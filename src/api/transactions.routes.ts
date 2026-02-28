import type { FastifyInstance } from 'fastify';
import { and, gte, lte, like, desc, eq, sql, count, inArray } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { transactions, accounts } from '../db/schema.js';
import { transactionQuerySchema, ignoreTransactionSchema, updateTransactionSchema, escapeLike } from './validation.js';

export async function transactionsRoutes(app: FastifyInstance) {

  app.get('/api/transactions', async (request, reply) => {
    const parsed = transactionQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const { accountType, ...rest } = parsed.data;
    const {
      accountId, startDate, endDate, category, status,
      minAmount, maxAmount, search,
      offset, limit, sortBy, sortOrder,
    } = rest;

    const conditions = [];

    if (accountType) {
      const matchingAccounts = db.select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.accountType, accountType))
        .all();
      const ids = matchingAccounts.map(a => a.id);
      if (ids.length > 0) {
        conditions.push(inArray(transactions.accountId, ids));
      } else {
        return reply.send({ transactions: [], pagination: { total: 0, offset, limit, hasMore: false } });
      }
    }

    if (accountId !== undefined) conditions.push(eq(transactions.accountId, accountId));
    if (startDate) conditions.push(gte(transactions.date, startDate));
    if (endDate) conditions.push(lte(transactions.date, endDate));
    if (category) conditions.push(eq(transactions.category, category));
    if (status) conditions.push(eq(transactions.status, status));
    if (minAmount !== undefined) conditions.push(gte(transactions.chargedAmount, minAmount));
    if (maxAmount !== undefined) conditions.push(lte(transactions.chargedAmount, maxAmount));
    if (search) conditions.push(like(transactions.description, `%${escapeLike(search)}%`));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ total }] = db
      .select({ total: count() })
      .from(transactions)
      .where(where)
      .all();

    const sortColumn = sortBy === 'chargedAmount' ? transactions.chargedAmount
      : sortBy === 'description' ? transactions.description
      : sortBy === 'processedDate' ? transactions.processedDate
      : transactions.date;

    const orderFn = sortOrder === 'asc' ? sql`${sortColumn} asc` : desc(sortColumn);

    const rows = db
      .select()
      .from(transactions)
      .where(where)
      .orderBy(orderFn)
      .limit(limit)
      .offset(offset)
      .all();

    return reply.send({
      transactions: rows,
      pagination: {
        total,
        offset,
        limit,
        hasMore: offset + limit < total,
      },
    });
  });

  app.patch('/api/transactions/:id/ignore', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.status(400).send({ error: 'Invalid transaction id' });
    }

    const parsed = ignoreTransactionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const existing = db.select().from(transactions).where(eq(transactions.id, id)).get();
    if (!existing) {
      return reply.status(404).send({ error: 'Transaction not found' });
    }

    const [updated] = db
      .update(transactions)
      .set({ ignored: parsed.data.ignored })
      .where(eq(transactions.id, id))
      .returning()
      .all();

    return reply.send({ transaction: updated });
  });

  app.patch('/api/transactions/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.status(400).send({ error: 'Invalid transaction id' });
    }

    const parsed = updateTransactionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
    }

    const existing = db.select().from(transactions).where(eq(transactions.id, id)).get();
    if (!existing) return reply.status(404).send({ error: 'Transaction not found' });

    const [updated] = db
      .update(transactions)
      .set({ category: parsed.data.category })
      .where(eq(transactions.id, id))
      .returning()
      .all();

    return reply.send({ transaction: updated });
  });
}
