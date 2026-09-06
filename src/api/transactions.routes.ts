import type { FastifyInstance } from 'fastify';
import {
  ignoreTransactionSchema,
  updateTransactionSchema,
  updateTransactionOwnerSchema,
  resolveReviewSchema,
} from './validation.js';
import { validateBody, sendServiceError } from './helpers.js';
import {
  getNeedsReviewCount,
  resolveReview,
  setTransactionIgnored,
  updateTransactionCategory,
} from '../services/transactions.js';
import { setTransactionOwner } from '../services/ownership.js';
import { config } from '../config.js';
import { resolveTransactionIdentifier } from '../services/transactions.js';
import { isMobilePublicId } from '../mobile/mobile-public-id.js';

function transactionId(value: string, reply: import('fastify').FastifyReply): number | null {
  if (!isMobilePublicId(value, 'transaction')) {
    reply.status(400).send({ error: 'Invalid transaction id' });
    return null;
  }
  const id = resolveTransactionIdentifier(value, config.MOBILE_PUBLIC_ID_KEY);
  if (id !== null) return id;
  reply.status(404).send({ error: 'Transaction not found' });
  return null;
}

export async function transactionsRoutes(app: FastifyInstance) {
  app.get('/api/transactions/needs-review/count', async (_request, reply) => {
    return reply.send({ count: getNeedsReviewCount() });
  });

  app.patch<{ Params: { id: string } }>('/api/transactions/:id/resolve', async (request, reply) => {
    const id = transactionId(request.params.id, reply);
    if (id === null) return;
    const data = validateBody(resolveReviewSchema, request.body, reply);
    if (!data) return;
    const updated = resolveReview(id, data.category);
    if (!updated) return reply.status(404).send({ error: 'Transaction not found' });
    return reply.send({ transaction: updated });
  });

  app.patch<{ Params: { id: string } }>('/api/transactions/:id/ignore', async (request, reply) => {
    const id = transactionId(request.params.id, reply);
    if (id === null) return;
    const data = validateBody(ignoreTransactionSchema, request.body, reply);
    if (!data) return;
    const updated = setTransactionIgnored(id, data.ignored);
    if (!updated) return reply.status(404).send({ error: 'Transaction not found' });
    return reply.send({ transaction: updated });
  });

  app.patch<{ Params: { id: string } }>('/api/transactions/:id', async (request, reply) => {
    const id = transactionId(request.params.id, reply);
    if (id === null) return;
    const data = validateBody(updateTransactionSchema, request.body, reply);
    if (!data) return;
    const updated = updateTransactionCategory(id, data.category);
    if (!updated) return reply.status(404).send({ error: 'Transaction not found' });
    return reply.send({ transaction: updated });
  });

  app.patch<{ Params: { id: string } }>('/api/transactions/:id/owner', async (request, reply) => {
    const id = transactionId(request.params.id, reply);
    if (id === null) return;
    const data = validateBody(updateTransactionOwnerSchema, request.body, reply);
    if (!data) return;
    const result = setTransactionOwner(id, {
      type: data.ownerType,
      memberId: data.ownerMemberId,
    });
    if (!result.ok) return sendServiceError(reply, result);
    return reply.send({ transaction: result.transaction });
  });
}
