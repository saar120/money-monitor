import type { FastifyInstance } from 'fastify';
import { chat, batchCategorize } from '../ai/agent.js';
import type { ChatMessage } from '../ai/agent.js';

export async function aiRoutes(app: FastifyInstance) {

  app.post<{
    Body: {
      messages: ChatMessage[];
    }
  }>('/api/ai/chat', async (request, reply) => {
    const { messages } = request.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return reply.status(400).send({ error: 'messages array is required' });
    }

    for (const msg of messages) {
      if (!msg.role || !msg.content || !['user', 'assistant'].includes(msg.role)) {
        return reply.status(400).send({
          error: 'Each message must have a "role" (user|assistant) and "content" string',
        });
      }
    }

    try {
      const response = await chat(messages);
      return reply.send({ response });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI chat failed';
      return reply.status(500).send({ error: message });
    }
  });

  app.post<{
    Body: { batchSize?: number }
  }>('/api/ai/categorize', async (request, reply) => {
    const batchSize = request.body?.batchSize ?? 50;

    try {
      const result = await batchCategorize(batchSize);
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Categorization failed';
      return reply.status(500).send({ error: message });
    }
  });
}
