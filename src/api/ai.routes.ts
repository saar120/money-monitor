import type { FastifyInstance } from 'fastify';
import { chat, batchCategorize, recategorize } from '../ai/agent.js';
import { chatSchema, categorizeSchema, recategorizeSchema } from './validation.js';
import { validateBody } from './helpers.js';

export async function aiRoutes(app: FastifyInstance) {

  app.post('/api/ai/chat', async (request, reply) => {
    const data = validateBody(chatSchema, request.body, reply);
    if (!data) return;

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    try {
      for await (const event of chat(data.messages)) {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify({ text: event.text })}\n\n`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI chat failed';
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ text: message })}\n\n`);
    } finally {
      reply.raw.end();
    }
  });

  app.post('/api/ai/categorize', async (request, reply) => {
    const data = validateBody(categorizeSchema, request.body ?? {}, reply);
    if (!data) return;

    try {
      const result = await batchCategorize(data.batchSize);
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Categorization failed';
      return reply.status(500).send({ error: message });
    }
  });

  app.post('/api/ai/recategorize', async (request, reply) => {
    const data = validateBody(recategorizeSchema, request.body ?? {}, reply);
    if (!data) return;

    try {
      const result = await recategorize(data.startDate, data.endDate);
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Recategorization failed';
      return reply.status(500).send({ error: message });
    }
  });
}
