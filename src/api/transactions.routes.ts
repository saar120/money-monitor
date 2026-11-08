import { saveReviewDecision, undoReviewDecision } from '../services/transaction-review.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  transactionQuerySchema,
  reviewDecisionSchema,
  undoReviewDecisionSchema,
} from './validation.js';
import { parseIntParam, validateBody, validateQuery } from './helpers.js';
import {
  commandTransaction,
  transactionCommandSchema,
  listTransactions,
  getTransactionById,
  getActivitySince,
  getNeedsReviewCount,
} from '../services/transactions.js';
import { FinancialCommandError } from '../services/financial-command.js';

export async function transactionsRoutes(app: FastifyInstance) {
  app.get('/api/transactions/capabilities', async () => ({
    commands: ['transaction.v1', 'recurring-decision.v1', 'holding-prices.v1'],
  }));
  app.post<{ Params: { id: string } }>('/api/transactions/:id/commands', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'transaction id', reply);
    if (id === null) return;
    const command = validateBody(transactionCommandSchema, request.body, reply);
    if (!command) return;
    try {
      return commandTransaction(id, command, 'desktop');
    } catch (error) {
      if (error instanceof FinancialCommandError)
        return reply
          .status(error.status)
          .send({ error: error.code, code: error.code, current: error.current });
      throw error;
    }
  });
  for (const undo of [false, true]) {
    app.patch<{ Params: { id: string } }>(
      `/api/transactions/:id/review${undo ? '/undo' : ''}`,
      async (request, reply) => {
        const id = parseIntParam(request.params.id, 'transaction id', reply);
        if (id === null) return;
        if (!request.body || typeof request.body !== 'object' || !('commandId' in request.body))
          return reply
            .status(426)
            .send({ code: 'update_required', error: 'Update Money Monitor to save changes.' });
        try {
          if (undo) {
            const data = validateBody(undoReviewDecisionSchema, request.body, reply);
            if (!data) return;
            return undoReviewDecision(id, data);
          }
          const data = validateBody(reviewDecisionSchema, request.body, reply);
          if (!data) return;
          return saveReviewDecision(id, data);
        } catch (error) {
          if (error instanceof FinancialCommandError)
            return reply
              .status(error.status)
              .send({ error: error.code, code: error.code, current: error.current });
          throw error;
        }
      },
    );
  }
  app.get('/api/transactions', async (request, reply) => {
    const data = validateQuery(transactionQuerySchema, request.query, reply);
    if (!data) return;
    const {
      accountType,
      accountId,
      startDate,
      endDate,
      category,
      status,
      needsReview,
      ignored,
      minAmount,
      maxAmount,
      search,
      ownerType,
      ownerMemberId,
      offset,
      limit,
      sortBy,
      sortOrder,
    } = data;
    const result = listTransactions(
      {
        accountType,
        accountId,
        startDate,
        endDate,
        category,
        status,
        needsReview,
        ignored,
        minAmount,
        maxAmount,
        search,
        ownerType,
        ownerMemberId,
      },
      { offset, limit, sortBy, sortOrder },
    );
    return reply.send(result);
  });

  app.get('/api/transactions/needs-review/count', async (_request, reply) => {
    return reply.send({ count: getNeedsReviewCount() });
  });

  app.get('/api/transactions/since', async (request, reply) => {
    const query = validateQuery(z.object({ since: z.iso.datetime() }), request.query, reply);
    if (!query) return;
    return reply.send(getActivitySince(query.since));
  });

  app.get<{ Params: { id: string } }>('/api/transactions/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'transaction id', reply);
    if (id === null) return;
    const transaction = getTransactionById(id);
    if (!transaction) return reply.status(404).send({ error: 'Transaction not found' });
    return reply.send({ transaction });
  });

  // Mixed-version reads stay available; legacy unversioned writes fail closed.
  for (const path of ['', '/resolve', '/ignore', '/effective-date', '/owner']) {
    app.patch(`/api/transactions/:id${path}`, async (_request, reply) =>
      reply
        .status(426)
        .send({ error: 'Update Money Monitor to save changes.', code: 'update_required' }),
    );
  }
}
