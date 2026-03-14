import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validateQuery, validateBody } from './helpers.js';
import { fetchQuote, updateAllStockPrices } from '../services/stock-prices.js';
import { generateAllAssetSnapshots } from '../services/assets.js';

const quoteQuerySchema = z.object({
  symbol: z.string().min(1).max(20),
});

const updatePricesSchema = z.object({
  generateSnapshots: z.boolean().default(true),
});

export async function stockPricesRoutes(app: FastifyInstance) {
  // GET /api/stock-prices/quote?symbol=AAPL
  app.get<{ Querystring: Record<string, string> }>(
    '/api/stock-prices/quote',
    async (request, reply) => {
      const query = validateQuery(quoteQuerySchema, request.query, reply);
      if (!query) return;

      const quote = await fetchQuote(query.symbol);
      if (!quote) {
        return reply.status(404).send({ error: `No quote found for symbol "${query.symbol}"` });
      }

      return reply.send(quote);
    },
  );

  // POST /api/stock-prices/update
  app.post('/api/stock-prices/update', async (request, reply) => {
    const body = validateBody(updatePricesSchema, request.body ?? {}, reply);
    if (!body) return;

    const result = await updateAllStockPrices();

    if (body.generateSnapshots && result.updated > 0) {
      try {
        await generateAllAssetSnapshots();
      } catch (err) {
        console.error('[stock-prices] Failed to generate snapshots:', err);
      }
    }

    return reply.send(result);
  });
}
