import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { liabilities } from '../db/schema.js';
import { parseIntParam, validateBody, validateQuery } from './helpers.js';
import {
  createLiabilitySchema, updateLiabilitySchema, liabilitiesQuerySchema,
} from './validation.js';
import { getExchangeRates, convertToIls } from '../services/exchange-rates.js';

export async function liabilitiesRoutes(app: FastifyInstance) {

  // GET /api/liabilities
  app.get<{ Querystring: Record<string, string> }>('/api/liabilities', async (request, reply) => {
    const query = validateQuery(liabilitiesQuerySchema, request.query, reply);
    if (!query) return;

    const { rates } = await getExchangeRates();

    let rows;
    if (query.includeInactive) {
      rows = db.select().from(liabilities).all();
    } else {
      rows = db.select().from(liabilities).where(eq(liabilities.isActive, true)).all();
    }

    const result = rows.map(row => ({
      ...row,
      currentBalanceIls: convertToIls(row.currentBalance, row.currency, rates),
    }));

    return reply.send(result);
  });

  // POST /api/liabilities
  app.post('/api/liabilities', async (request, reply) => {
    const data = validateBody(createLiabilitySchema, request.body, reply);
    if (!data) return;

    // Check unique name
    const existing = db.select({ id: liabilities.id }).from(liabilities)
      .where(eq(liabilities.name, data.name)).get();
    if (existing) return reply.status(409).send({ error: 'Liability name already exists' });

    const result = db.insert(liabilities).values({
      name: data.name,
      type: data.type,
      currency: data.currency,
      originalAmount: data.originalAmount,
      currentBalance: data.currentBalance,
      interestRate: data.interestRate,
      startDate: data.startDate,
      notes: data.notes,
    }).returning().get();

    const { rates } = await getExchangeRates();
    return reply.status(201).send({
      ...result,
      currentBalanceIls: convertToIls(result.currentBalance, result.currency, rates),
    });
  });

  // PUT /api/liabilities/:id
  app.put<{ Params: { id: string } }>('/api/liabilities/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'liability ID', reply);
    if (id === null) return;

    const existing = db.select().from(liabilities).where(eq(liabilities.id, id)).get();
    if (!existing) return reply.status(404).send({ error: 'Liability not found' });

    const data = validateBody(updateLiabilitySchema, request.body, reply);
    if (!data) return;

    // Check unique name if changing
    if (data.name && data.name !== existing.name) {
      const dup = db.select({ id: liabilities.id }).from(liabilities)
        .where(eq(liabilities.name, data.name)).get();
      if (dup) return reply.status(409).send({ error: 'Liability name already exists' });
    }

    const updateSet: Record<string, unknown> = {};
    if (data.name !== undefined) updateSet.name = data.name;
    if (data.type !== undefined) updateSet.type = data.type;
    if (data.currency !== undefined) updateSet.currency = data.currency;
    if (data.originalAmount !== undefined) updateSet.originalAmount = data.originalAmount;
    if (data.currentBalance !== undefined) updateSet.currentBalance = data.currentBalance;
    if (data.interestRate !== undefined) updateSet.interestRate = data.interestRate;
    if (data.startDate !== undefined) updateSet.startDate = data.startDate;
    if (data.notes !== undefined) updateSet.notes = data.notes;

    if (Object.keys(updateSet).length > 0) {
      db.update(liabilities).set(updateSet).where(eq(liabilities.id, id)).run();
    }

    const updated = db.select().from(liabilities).where(eq(liabilities.id, id)).get();
    if (!updated) return reply.status(404).send({ error: 'Liability not found after update' });
    const { rates } = await getExchangeRates();
    return reply.send({
      ...updated,
      currentBalanceIls: convertToIls(updated.currentBalance, updated.currency, rates),
    });
  });

  // DELETE /api/liabilities/:id (soft delete)
  app.delete<{ Params: { id: string } }>('/api/liabilities/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'liability ID', reply);
    if (id === null) return;

    const existing = db.select({ id: liabilities.id }).from(liabilities)
      .where(eq(liabilities.id, id)).get();
    if (!existing) return reply.status(404).send({ error: 'Liability not found' });

    db.update(liabilities).set({ isActive: false }).where(eq(liabilities.id, id)).run();
    return reply.status(204).send();
  });
}
