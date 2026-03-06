import type { FastifyInstance } from 'fastify';
import { getExchangeRates } from '../services/exchange-rates.js';

export async function exchangeRatesRoutes(app: FastifyInstance) {
  app.get('/api/exchange-rates', async (_request, reply) => {
    const result = await getExchangeRates();
    return reply.send(result);
  });
}
