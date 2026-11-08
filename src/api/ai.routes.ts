import {
  advisorReplies,
  ReplyAdmissionError,
  streamAdvisorOperation,
} from '../ai/advisor-replies.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { chat, batchCategorize, recategorize } from '../ai/agent.js';
import { categorizeSchema, recategorizeSchema, sessionChatSchema } from './validation.js';
import { validateBody } from './helpers.js';
import { createSession, getSession, listSessions, deleteSession } from '../ai/sessions.js';

export async function aiRoutes(app: FastifyInstance) {
  // ── Session CRUD ───────────────────────────────────────────────────────

  app.get('/api/ai/sessions', async () => {
    return { sessions: listSessions() };
  });

  app.post('/api/ai/sessions', async (request, reply) => {
    const parsed = z.object({ id: z.string().uuid().optional() }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid session ID' });
    const meta = createSession(parsed.data.id);
    return { session: meta };
  });

  app.get<{ Params: { id: string } }>('/api/ai/sessions/:id', async (request, reply) => {
    const { id } = request.params;
    if (!z.uuid().safeParse(id).success)
      return reply.code(400).send({ error: 'Invalid session ID' });
    const session = getSession(id);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    return { session };
  });

  app.delete<{ Params: { id: string } }>('/api/ai/sessions/:id', async (request, reply) => {
    const { id } = request.params;
    if (!z.uuid().safeParse(id).success)
      return reply.code(400).send({ error: 'Invalid session ID' });
    if (advisorReplies.busy(id))
      return reply.code(409).send({ error: 'This chat is still receiving a reply.' });
    const deleted = deleteSession(id);
    if (!deleted) return reply.status(404).send({ error: 'Session not found' });
    return { deleted: true };
  });

  // ── Chat (session-based) ──────────────────────────────────────────────

  app.get<{ Params: { id: string; replyId: string } }>(
    '/api/ai/sessions/:id/replies/:replyId',
    async (request, reply) => {
      if (
        !z.uuid().safeParse(request.params.id).success ||
        !z.uuid().safeParse(request.params.replyId).success
      )
        return reply.code(400).send({ error: 'Invalid reply ID' });
      const operation = advisorReplies.read(request.params.id, request.params.replyId);
      return operation ? { reply: operation } : reply.code(404).send({ error: 'Reply not found' });
    },
  );
  app.post('/api/ai/chat', async (request, reply) => {
    const data = validateBody(sessionChatSchema, request.body, reply);
    if (!data) return;
    if (!data.submissionId)
      return reply
        .code(426)
        .send({ code: 'update_required', error: 'Update Money Monitor to send a question.' });
    try {
      const operation = advisorReplies.start(
        data.sessionId,
        { id: data.submissionId, clientId: 'desktop', message: data.message },
        (history, context) => chat(history, undefined, context),
      );
      return await streamAdvisorOperation(reply, operation);
    } catch (cause) {
      if (cause instanceof ReplyAdmissionError)
        return reply
          .code(
            cause.code === 'not_found' ? 404 : cause.code === 'reply_storage_failed' ? 500 : 409,
          )
          .send({ error: cause.message, code: cause.code });
      throw cause;
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
