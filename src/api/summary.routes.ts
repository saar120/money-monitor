import type { FastifyInstance } from 'fastify';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { transactions, accounts } from '../db/schema.js';
import { summaryQuerySchema } from './validation.js';

export async function summaryRoutes(app: FastifyInstance) {

  app.get('/api/transactions/summary', async (request, reply) => {
    const parsed = summaryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const { accountId, startDate, endDate, groupBy } = parsed.data;

    const conditions = [];
    if (accountId !== undefined) conditions.push(eq(transactions.accountId, accountId));
    if (startDate) conditions.push(gte(transactions.date, startDate));
    if (endDate) conditions.push(lte(transactions.date, endDate));
    conditions.push(eq(transactions.ignored, false));

    const where = and(...conditions);

    if (groupBy === 'month') {
      const rows = db
        .select({
          month: sql<string>`strftime('%Y-%m', ${transactions.date})`.as('month'),
          totalAmount: sql<number>`SUM(${transactions.chargedAmount})`.as('total_amount'),
          transactionCount: sql<number>`COUNT(*)`.as('transaction_count'),
        })
        .from(transactions)
        .where(where)
        .groupBy(sql`strftime('%Y-%m', ${transactions.date})`)
        .orderBy(sql`month desc`)
        .all();

      return reply.send({ groupBy: 'month', summary: rows });
    }

    if (groupBy === 'account') {
      const rows = db
        .select({
          accountId: transactions.accountId,
          displayName: accounts.displayName,
          companyId: accounts.companyId,
          totalAmount: sql<number>`SUM(${transactions.chargedAmount})`.as('total_amount'),
          transactionCount: sql<number>`COUNT(*)`.as('transaction_count'),
        })
        .from(transactions)
        .innerJoin(accounts, eq(transactions.accountId, accounts.id))
        .where(where)
        .groupBy(transactions.accountId)
        .all();

      return reply.send({ groupBy: 'account', summary: rows });
    }

    // Default: group by category
    const rows = db
      .select({
        category: sql<string>`COALESCE(${transactions.category}, 'uncategorized')`.as('category'),
        totalAmount: sql<number>`SUM(${transactions.chargedAmount})`.as('total_amount'),
        transactionCount: sql<number>`COUNT(*)`.as('transaction_count'),
      })
      .from(transactions)
      .where(where)
      .groupBy(sql`COALESCE(${transactions.category}, 'uncategorized')`)
      .orderBy(sql`total_amount desc`)
      .all();

    return reply.send({ groupBy: 'category', summary: rows });
  });
}
