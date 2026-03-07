import type { FastifyInstance } from 'fastify';
import { parseIntParam, validateBody, validateQuery, sendServiceError } from './helpers.js';
import {
  createLiabilitySchema, updateLiabilitySchema, liabilitiesQuerySchema,
} from './validation.js';
import { listLiabilities, createLiability, updateLiability, deactivateLiability } from '../services/liabilities.js';

export async function liabilitiesRoutes(app: FastifyInstance) {

  // GET /api/liabilities
  app.get<{ Querystring: Record<string, string> }>('/api/liabilities', async (request, reply) => {
    const query = validateQuery(liabilitiesQuerySchema, request.query, reply);
    if (!query) return;

    const result = await listLiabilities({ includeInactive: query.includeInactive });
    return reply.send(result);
  });

  // POST /api/liabilities
  app.post('/api/liabilities', async (request, reply) => {
    const data = validateBody(createLiabilitySchema, request.body, reply);
    if (!data) return;

    const result = await createLiability(data);
    if (!result.ok) return sendServiceError(reply, result);
    return reply.status(201).send(result.liability);
  });

  // PUT /api/liabilities/:id
  app.put<{ Params: { id: string } }>('/api/liabilities/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'liability ID', reply);
    if (id === null) return;

    const data = validateBody(updateLiabilitySchema, request.body, reply);
    if (!data) return;

    const result = await updateLiability(id, data);
    if (!result.ok) return sendServiceError(reply, result);
    return reply.send(result.liability);
  });

  // DELETE /api/liabilities/:id (soft delete)
  app.delete<{ Params: { id: string } }>('/api/liabilities/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'liability ID', reply);
    if (id === null) return;

    const result = await deactivateLiability(id);
    if (!result.ok) return sendServiceError(reply, result);
    return reply.status(204).send();
  });
}
