import type { FastifyInstance } from 'fastify';
import { listCategories, createCategory, updateCategory, deleteCategory } from '../services/categories.js';
import { createCategorySchema, updateCategorySchema } from './validation.js';
import { parseIntParam, validateBody, sendServiceError } from './helpers.js';

export async function categoriesRoutes(app: FastifyInstance) {

  app.get('/api/categories', async (_request, reply) => {
    return reply.send({ categories: listCategories() });
  });

  app.post('/api/categories', async (request, reply) => {
    const data = validateBody(createCategorySchema, request.body, reply);
    if (!data) return;
    const result = createCategory(data);
    if (!result.ok) return sendServiceError(reply, result);
    return reply.status(201).send({ category: result.category });
  });

  app.patch<{ Params: { id: string } }>('/api/categories/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'category id', reply);
    if (id === null) return;
    const data = validateBody(updateCategorySchema, request.body, reply);
    if (!data) return;
    const result = updateCategory(id, data);
    if (!result.ok) return sendServiceError(reply, result);
    return reply.send({ category: result.category });
  });

  app.delete<{ Params: { id: string } }>('/api/categories/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'category id', reply);
    if (id === null) return;
    const result = deleteCategory(id);
    if (!result.ok) return sendServiceError(reply, result);
    return reply.send({ deleted: true });
  });
}
