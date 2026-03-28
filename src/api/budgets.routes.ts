import type { FastifyInstance } from 'fastify';
import {
  listBudgets,
  getBudget,
  createBudget,
  updateBudget,
  deleteBudget,
  getBudgetProgress,
  getAllBudgetProgress,
} from '../services/budgets.js';
import { createBudgetSchema, updateBudgetSchema, budgetProgressQuerySchema } from './validation.js';
import { parseIntParam, validateBody, validateQuery, sendServiceError } from './helpers.js';

export async function budgetsRoutes(app: FastifyInstance) {
  app.get('/api/budgets', async (_request, reply) => {
    return reply.send({ budgets: listBudgets() });
  });

  app.get('/api/budgets/progress', async (request, reply) => {
    const query = validateQuery(budgetProgressQuerySchema, request.query, reply);
    if (!query) return;
    return reply.send({ progress: getAllBudgetProgress(query.monthlyView ?? false) });
  });

  app.get<{ Params: { id: string } }>('/api/budgets/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'budget id', reply);
    if (id === null) return;
    const budget = getBudget(id);
    if (!budget) return reply.status(404).send({ error: 'Budget not found' });
    return reply.send({ budget });
  });

  app.get<{ Params: { id: string } }>('/api/budgets/:id/progress', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'budget id', reply);
    if (id === null) return;
    const query = validateQuery(budgetProgressQuerySchema, request.query, reply);
    if (!query) return;
    const progress = getBudgetProgress(id, query.monthlyView ?? false);
    if (!progress) return reply.status(404).send({ error: 'Budget not found' });
    return reply.send(progress);
  });

  app.post('/api/budgets', async (request, reply) => {
    const data = validateBody(createBudgetSchema, request.body, reply);
    if (!data) return;
    const { budget } = createBudget(data);
    return reply.status(201).send({ budget });
  });

  app.patch<{ Params: { id: string } }>('/api/budgets/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'budget id', reply);
    if (id === null) return;
    const data = validateBody(updateBudgetSchema, request.body, reply);
    if (!data) return;
    const result = updateBudget(id, data);
    if (!result.ok) return sendServiceError(reply, result);
    return reply.send({ budget: result.budget });
  });

  app.delete<{ Params: { id: string } }>('/api/budgets/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'budget id', reply);
    if (id === null) return;
    const result = deleteBudget(id);
    if (!result.ok) return sendServiceError(reply, result);
    return reply.send({ deleted: true });
  });
}
