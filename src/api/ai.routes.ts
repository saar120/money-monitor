import type { FastifyInstance } from 'fastify';
import { chat, batchCategorize, recategorize } from '../ai/agent.js';
import { categorizeSchema, recategorizeSchema, sessionChatSchema } from './validation.js';
import { validateBody } from './helpers.js';
import {
  createSession,
  getSession,
  listSessions,
  deleteSession,
  appendMessage,
  getSessionMessages,
} from '../ai/sessions.js';

export async function aiRoutes(app: FastifyInstance) {

  // ── Session CRUD ───────────────────────────────────────────────────────

  app.get('/api/ai/sessions', async () => {
    return { sessions: listSessions() };
  });

  app.post('/api/ai/sessions', async () => {
    const meta = createSession();
    return { session: meta };
  });

  app.get<{ Params: { id: string } }>('/api/ai/sessions/:id', async (request, reply) => {
    const { id } = request.params;
    const session = getSession(id);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    return { session };
  });

  app.delete<{ Params: { id: string } }>('/api/ai/sessions/:id', async (request, reply) => {
    const { id } = request.params;
    const deleted = deleteSession(id);
    if (!deleted) return reply.status(404).send({ error: 'Session not found' });
    return { deleted: true };
  });

  // ── Chat (session-based) ──────────────────────────────────────────────

  app.post('/api/ai/chat', async (request, reply) => {
    const data = validateBody(sessionChatSchema, request.body, reply);
    if (!data) return;

    // Load session messages
    const history = getSessionMessages(data.sessionId);
    if (!history) return reply.status(404).send({ error: 'Session not found' });

    // Append user message to session file
    appendMessage(data.sessionId, 'user', data.message);

    // Build full conversation for the agent
    const conversationHistory = [...history, { role: 'user' as const, content: data.message }];

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let assistantResponse = '';

    try {
      for await (const event of chat(conversationHistory)) {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify({ text: event.text })}\n\n`);
        if (event.type === 'result') {
          assistantResponse = event.text;
        }
      }

      // Append assistant response to session file
      if (assistantResponse) {
        appendMessage(data.sessionId, 'assistant', assistantResponse);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI chat failed';
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ text: message })}\n\n`);
    } finally {
      reply.raw.end();
    }
  });

  // ── Categorization (unchanged) ────────────────────────────────────────

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
