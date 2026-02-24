import type { FastifyInstance } from 'fastify';
import { eq, and, gte, lte, like, desc, sql, count } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { transactions } from '../db/schema.js';

export async function transactionsRoutes(app: FastifyInstance) {

  app.get<{
    Querystring: {
      accountId?: string;
      startDate?: string;
      endDate?: string;
      category?: string;
      status?: string;
      minAmount?: string;
      maxAmount?: string;
      search?: string;
      offset?: string;
      limit?: string;
      sortBy?: string;
      sortOrder?: string;
    }
  }>('/api/transactions', async (request, reply) => {
    const {
      accountId, startDate, endDate, category, status,
      minAmount, maxAmount, search,
      offset: offsetParam, limit: limitParam,
      sortBy = 'date', sortOrder = 'desc',
    } = request.query;

    const limit = Math.min(parseInt(limitParam ?? '50', 10), 500);
    const offset = parseInt(offsetParam ?? '0', 10);

    const conditions = [];

    if (accountId) {
      conditions.push(eq(transactions.accountId, parseInt(accountId, 10)));
    }
    if (startDate) {
      conditions.push(gte(transactions.date, startDate));
    }
    if (endDate) {
      conditions.push(lte(transactions.date, endDate));
    }
    if (category) {
      conditions.push(eq(transactions.category, category));
    }
    if (status) {
      conditions.push(eq(transactions.status, status));
    }
    if (minAmount) {
      conditions.push(gte(transactions.chargedAmount, parseFloat(minAmount)));
    }
    if (maxAmount) {
      conditions.push(lte(transactions.chargedAmount, parseFloat(maxAmount)));
    }
    if (search) {
      conditions.push(like(transactions.description, `%${search}%`));
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
}
