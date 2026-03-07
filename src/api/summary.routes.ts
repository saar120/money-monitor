import type { FastifyInstance } from 'fastify';
import { summaryQuerySchema } from './validation.js';
import { validateQuery } from './helpers.js';
import { getSpendingSummary } from '../services/summary.js';

export async function summaryRoutes(app: FastifyInstance) {

  app.get('/api/transactions/summary', async (request, reply) => {
    const data = validateQuery(summaryQuerySchema, request.query, reply);
    if (!data) return;
    const { accountType, accountId, startDate, endDate, groupBy } = data;
    const result = getSpendingSummary({ accountType, accountId, startDate, endDate }, groupBy);
    return reply.send(result);
  });
}
