import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { categories, transactions } from '../db/schema.js';
import { createCategorySchema, updateCategorySchema } from './validation.js';
import { parseIntParam, validateBody } from './helpers.js';

export async function categoriesRoutes(app: FastifyInstance) {

  app.get('/api/categories', async (_request, reply) => {
    const rows = db.select().from(categories).all();
    return reply.send({ categories: rows });
  });

  app.post('/api/categories', async (request, reply) => {
    const data = validateBody(createCategorySchema, request.body, reply);
    if (!data) return;

    const existing = db.select().from(categories).where(eq(categories.name, data.name)).get();
    if (existing) {
      return reply.status(409).send({ error: 'Category name already exists' });
    }

    const [created] = db.insert(categories).values(data).returning().all();
    return reply.status(201).send({ category: created });
  });

  app.patch<{ Params: { id: string } }>('/api/categories/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'category id', reply);
    if (id === null) return;

    const data = validateBody(updateCategorySchema, request.body, reply);
    if (!data) return;

    const existing = db.select().from(categories).where(eq(categories.id, id)).get();
    if (!existing) return reply.status(404).send({ error: 'Category not found' });

    const [updated] = db.update(categories).set(data).where(eq(categories.id, id)).returning().all();

    // Cascade ignoredFromStats to transactions
    if (data.ignoredFromStats !== undefined) {
      db.update(transactions)
        .set({ ignored: data.ignoredFromStats })
        .where(eq(transactions.category, existing.name))
        .run();
    }

    return reply.send({ category: updated });
  });

  app.delete<{ Params: { id: string } }>('/api/categories/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'category id', reply);
    if (id === null) return;

    const existing = db.select().from(categories).where(eq(categories.id, id)).get();
    if (!existing) return reply.status(404).send({ error: 'Category not found' });

    db.delete(categories).where(eq(categories.id, id)).run();
    return reply.send({ deleted: true });
  });
}
