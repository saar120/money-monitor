import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql, count, gte, lte, inArray } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { transactions, categories } from '../db/schema.js';
import { searchTransactionIds } from '../db/queries.js';
import { transactionQuerySchema, ignoreTransactionSchema, updateTransactionSchema, resolveReviewSchema } from './validation.js';
import { parseIntParam, validateBody, validateQuery, buildTransactionFilters } from './helpers.js';

function isCategoryIgnored(categoryName: string | null): boolean {
  if (!categoryName) return false;
  const cat = db.select({ ignoredFromStats: categories.ignoredFromStats })
    .from(categories).where(eq(categories.name, categoryName)).get();
  return cat?.ignoredFromStats ?? false;
}

export async function transactionsRoutes(app: FastifyInstance) {

  app.get('/api/transactions', async (request, reply) => {
    const data = validateQuery(transactionQuerySchema, request.query, reply);
    if (!data) return;
    const {
      accountType, accountId, startDate, endDate,
      category, status, needsReview, minAmount, maxAmount, search,
      offset, limit, sortBy, sortOrder,
    } = data;

    const { conditions, empty } = buildTransactionFilters({ accountType, accountId, startDate, endDate });
    if (empty) return reply.send({ transactions: [], pagination: { total: 0, offset, limit, hasMore: false } });
    if (category) conditions.push(eq(transactions.category, category));
    if (status) conditions.push(eq(transactions.status, status));
    if (needsReview !== undefined) conditions.push(eq(transactions.needsReview, needsReview));
    if (minAmount !== undefined) conditions.push(gte(transactions.chargedAmount, minAmount));
    if (maxAmount !== undefined) conditions.push(lte(transactions.chargedAmount, maxAmount));
    if (search) {
      const ftsIds = searchTransactionIds(search);
      if (ftsIds.length === 0) {
        return reply.send({ transactions: [], pagination: { total: 0, offset, limit, hasMore: false } });
      }
      conditions.push(inArray(transactions.id, ftsIds));
    }

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

  app.get('/api/transactions/needs-review/count', async (_request, reply) => {
    const [{ total }] = db
      .select({ total: count() })
      .from(transactions)
      .where(eq(transactions.needsReview, true))
      .all();

    return reply.send({ count: total });
  });

  app.patch<{ Params: { id: string } }>('/api/transactions/:id/resolve', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'transaction id', reply);
    if (id === null) return;

    const data = validateBody(resolveReviewSchema, request.body, reply);
    if (!data) return;

    const [updated] = db
      .update(transactions)
      .set({ category: data.category, needsReview: false, reviewReason: null, ignored: isCategoryIgnored(data.category) })
      .where(eq(transactions.id, id))
      .returning()
      .all();

    if (!updated) return reply.status(404).send({ error: 'Transaction not found' });
    return reply.send({ transaction: updated });
  });

  app.patch<{ Params: { id: string } }>('/api/transactions/:id/ignore', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'transaction id', reply);
    if (id === null) return;

    const data = validateBody(ignoreTransactionSchema, request.body, reply);
    if (!data) return;

    const [updated] = db
      .update(transactions)
      .set({ ignored: data.ignored })
      .where(eq(transactions.id, id))
      .returning()
      .all();

    if (!updated) return reply.status(404).send({ error: 'Transaction not found' });
    return reply.send({ transaction: updated });
  });

  app.patch<{ Params: { id: string } }>('/api/transactions/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'transaction id', reply);
    if (id === null) return;

    const data = validateBody(updateTransactionSchema, request.body, reply);
    if (!data) return;

    const [updated] = db
      .update(transactions)
      .set({ category: data.category, needsReview: false, reviewReason: null, ignored: isCategoryIgnored(data.category) })
      .where(eq(transactions.id, id))
      .returning()
      .all();

    if (!updated) return reply.status(404).send({ error: 'Transaction not found' });
    return reply.send({ transaction: updated });
  });
}
