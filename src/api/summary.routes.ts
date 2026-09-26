import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { summaryQuerySchema } from './validation.js';
import { validateQuery } from './helpers.js';
import { getSpendingSummary } from '../services/summary.js';
import {
  readRecurringPaymentDetail,
  readRecurringPayments,
  saveRecurringPaymentDecision,
} from '../services/recurring-payments.js';
import { db } from '../db/connection.js';
import { todayInIsrael } from '../shared/dates.js';

export async function summaryRoutes(app: FastifyInstance) {
  app.get('/api/recurring-payments', async () => readRecurringPayments(db, todayInIsrael()));
  app.get('/api/recurring-payments/detail', async (request, reply) => {
    const parsed = z
      .object({
        accountId: z.coerce.number().int().positive(),
        currencyCode: z.string().min(1).max(10),
        merchantKey: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid payment' });
    const detail = readRecurringPaymentDetail(db, todayInIsrael(), parsed.data);
    if (!detail) return reply.code(404).send({ error: 'Payment not found' });
    return detail;
  });
  app.put('/api/recurring-payments/decision', async (request, reply) => {
    const parsed = z
      .object({
        accountId: z.number().int().positive(),
        currencyCode: z.string().min(1).max(10),
        merchantKey: z.string().min(1).max(160),
        decision: z.enum(['include', 'exclude', 'auto']),
      })
      .strict()
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid payment decision' });
    saveRecurringPaymentDecision(db, parsed.data);
    return readRecurringPayments(db, todayInIsrael());
  });
  app.get('/api/transactions/summary', async (request, reply) => {
    const data = validateQuery(summaryQuerySchema, request.query, reply);
    if (!data) return;
    const { groupBy, ...filters } = data;
    const result = getSpendingSummary(filters, groupBy);
    return reply.send(result);
  });
}
