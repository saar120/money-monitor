import type { FastifyInstance } from 'fastify';
import { and, gte, lte, like, desc, eq, sql, count } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { transactions } from '../db/schema.js';
import { transactionQuerySchema, escapeLike } from './validation.js';

export async function transactionsRoutes(app: FastifyInstance) {

  app.get('/api/transactions', async (request, reply) => {
    const parsed = transactionQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const {
      accountId, startDate, endDate, category, status,
      minAmount, maxAmount, search,
      offset, limit, sortBy, sortOrder,
    } = parsed.data;

    const conditions = [];

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
}
