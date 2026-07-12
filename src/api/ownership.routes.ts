import type { FastifyInstance } from 'fastify';
import {
  applyOwnership,
  createOwnershipRule,
  deleteOwnershipRule,
  listOwnershipRules,
  updateOwnershipRule,
} from '../services/ownership.js';
import {
  createOwnershipRuleSchema,
  ownershipRulesQuerySchema,
  updateOwnershipRuleSchema,
} from './validation.js';
import { parseIntParam, sendServiceError, validateBody, validateQuery } from './helpers.js';

export async function ownershipRoutes(app: FastifyInstance) {
  app.get('/api/ownership/rules', async (_request, reply) => {
    return reply.send({ rules: listOwnershipRules() });
  });

  app.post('/api/ownership/rules', async (request, reply) => {
    const data = validateBody(createOwnershipRuleSchema, request.body, reply);
    if (!data) return;
    const result = createOwnershipRule(data);
    if (!result.ok) return sendServiceError(reply, result);
    return reply.status(201).send({ rule: result.rule });
  });

  app.patch<{ Params: { id: string } }>('/api/ownership/rules/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'ownership rule id', reply);
    if (id === null) return;
    const data = validateBody(updateOwnershipRuleSchema, request.body, reply);
    if (!data) return;
    const result = updateOwnershipRule(id, data);
    if (!result.ok) return sendServiceError(reply, result);
    return reply.send({ rule: result.rule });
  });

  app.delete<{ Params: { id: string } }>('/api/ownership/rules/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'ownership rule id', reply);
    if (id === null) return;
    const result = deleteOwnershipRule(id);
    if (!result.ok) return sendServiceError(reply, result);
    return reply.send({ deleted: true });
  });

  app.post('/api/ownership/apply', async (request, reply) => {
    const data = validateQuery(ownershipRulesQuerySchema, request.query, reply);
    if (!data) return;
    const result = applyOwnership({
      startDate: data.startDate,
      endDate: data.endDate,
      force: data.force,
    });
    return reply.send(result);
  });
}
