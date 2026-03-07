import type { FastifyInstance } from 'fastify';
import { validateQuery } from './helpers.js';
import { netWorthHistoryQuerySchema } from './validation.js';
import { getNetWorth, getNetWorthHistory } from '../services/net-worth.js';

export async function netWorthRoutes(app: FastifyInstance) {

  // GET /api/net-worth
  app.get('/api/net-worth', async (_request, reply) => {
    const result = await getNetWorth();
    return reply.send(result);
  });

  // GET /api/net-worth/history
  app.get<{ Querystring: Record<string, string> }>('/api/net-worth/history', async (request, reply) => {
    const query = validateQuery(netWorthHistoryQuerySchema, request.query, reply);
    if (!query) return;

    const result = await getNetWorthHistory({
      startDate: query.startDate,
      endDate: query.endDate,
      granularity: query.granularity,
    });
    if ('error' in result) return reply.status(400).send({ error: result.error });
    return reply.send(result);
  });
}
