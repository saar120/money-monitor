import type { FastifyInstance } from 'fastify';
import { transactionQuerySchema, ignoreTransactionSchema, updateTransactionSchema, resolveReviewSchema } from './validation.js';
import { parseIntParam, validateBody, validateQuery } from './helpers.js';
import { listTransactions, getNeedsReviewCount, resolveReview, setTransactionIgnored, updateTransactionCategory } from '../services/transactions.js';

export async function transactionsRoutes(app: FastifyInstance) {

  app.get('/api/transactions', async (request, reply) => {
    const data = validateQuery(transactionQuerySchema, request.query, reply);
    if (!data) return;
    const {
      accountType, accountId, startDate, endDate,
      category, status, needsReview, minAmount, maxAmount, search,
      offset, limit, sortBy, sortOrder,
    } = data;
    const result = listTransactions(
      { accountType, accountId, startDate, endDate, category, status, needsReview, minAmount, maxAmount, search },
      { offset, limit, sortBy, sortOrder },
    );
    return reply.send(result);
  });

  app.get('/api/transactions/needs-review/count', async (_request, reply) => {
    return reply.send({ count: getNeedsReviewCount() });
  });

  app.patch<{ Params: { id: string } }>('/api/transactions/:id/resolve', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'transaction id', reply);
    if (id === null) return;
    const data = validateBody(resolveReviewSchema, request.body, reply);
    if (!data) return;
    const updated = resolveReview(id, data.category);
    if (!updated) return reply.status(404).send({ error: 'Transaction not found' });
    return reply.send({ transaction: updated });
  });

  app.patch<{ Params: { id: string } }>('/api/transactions/:id/ignore', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'transaction id', reply);
    if (id === null) return;
    const data = validateBody(ignoreTransactionSchema, request.body, reply);
    if (!data) return;
    const updated = setTransactionIgnored(id, data.ignored);
    if (!updated) return reply.status(404).send({ error: 'Transaction not found' });
    return reply.send({ transaction: updated });
  });

  app.patch<{ Params: { id: string } }>('/api/transactions/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'transaction id', reply);
    if (id === null) return;
    const data = validateBody(updateTransactionSchema, request.body, reply);
    if (!data) return;
    const updated = updateTransactionCategory(id, data.category);
    if (!updated) return reply.status(404).send({ error: 'Transaction not found' });
    return reply.send({ transaction: updated });
  });
}
