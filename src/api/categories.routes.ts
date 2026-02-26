import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { categories } from '../db/schema.js';
import { createCategorySchema, updateCategorySchema } from './validation.js';

export async function categoriesRoutes(app: FastifyInstance) {

  app.get('/api/categories', async (_request, reply) => {
    const rows = db.select().from(categories).all();
    return reply.send({ categories: rows });
  });

  app.post('/api/categories', async (request, reply) => {
    const parsed = createCategorySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
    }

    const existing = db.select().from(categories).where(eq(categories.name, parsed.data.name)).get();
    if (existing) {
      return reply.status(409).send({ error: 'Category name already exists' });
    }

    const [created] = db.insert(categories).values(parsed.data).returning().all();
    return reply.status(201).send({ category: created });
  });

  app.patch('/api/categories/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.status(400).send({ error: 'Invalid category id' });
    }

    const parsed = updateCategorySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
    }

    const existing = db.select().from(categories).where(eq(categories.id, id)).get();
    if (!existing) return reply.status(404).send({ error: 'Category not found' });

    const [updated] = db.update(categories).set(parsed.data).where(eq(categories.id, id)).returning().all();
    return reply.send({ category: updated });
  });

  app.delete('/api/categories/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.status(400).send({ error: 'Invalid category id' });
    }

    const existing = db.select().from(categories).where(eq(categories.id, id)).get();
    if (!existing) return reply.status(404).send({ error: 'Category not found' });

    db.delete(categories).where(eq(categories.id, id)).run();
    return reply.send({ deleted: true });
  });
}
