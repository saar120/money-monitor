import type { FastifyInstance } from 'fastify';
import { chat, batchCategorize } from '../ai/agent.js';
import { chatSchema, categorizeSchema } from './validation.js';

export async function aiRoutes(app: FastifyInstance) {

  app.post('/api/ai/chat', async (request, reply) => {
    const parsed = chatSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    try {
      const response = await chat(parsed.data.messages);
      return reply.send({ response });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI chat failed';
      return reply.status(500).send({ error: message });
    }
  });

  app.post('/api/ai/categorize', async (request, reply) => {
    const parsed = categorizeSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    try {
      const result = await batchCategorize(parsed.data.batchSize);
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Categorization failed';
      return reply.status(500).send({ error: message });
    }
  });
}
