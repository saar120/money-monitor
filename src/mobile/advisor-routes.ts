import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ChatEvent, ChatMessage } from '../ai/agent.js';
import { advisorChartSchema, type AdvisorChart } from '../ai/advisor-chart.js';
import { beginSessionReply, endSessionReply } from '../ai/sessions.js';
import type { Session, SessionMeta, SessionSummary } from '../ai/sessions.js';
import { MobileApiError, createMobileSuccessEnvelope } from './contract.js';
import {
  createMobileAuthenticationHook,
  type MobileCredentialAuthenticator,
} from './mobile-auth.js';

const idSchema = z.uuid();
const messageSchema = z.object({ message: z.string().trim().min(1).max(4000) }).strict();

export interface MobileAdvisorDependencies {
  authenticator: MobileCredentialAuthenticator;
  server: { id: string };
  available?: () => boolean;
  list(): SessionSummary[];
  create(): SessionMeta;
  get(id: string): Session | null;
  append(id: string, role: 'user' | 'assistant', content: string, chart?: AdvisorChart): unknown;
  chat(history: ChatMessage[]): AsyncGenerator<ChatEvent>;
}

export function registerMobileAdvisorRoutes(
  app: FastifyInstance,
  deps: MobileAdvisorDependencies,
  clock: () => Date,
) {
  const auth = createMobileAuthenticationHook(deps.authenticator, 'mobile.read');
  const envelope = (data: unknown) => {
    const response = createMobileSuccessEnvelope(data, clock());
    return { ...response, meta: { ...response.meta, server: deps.server } };
  };
  const available = () => {
    if (deps.available && !deps.available()) throw new MobileApiError('forbidden');
  };
  app.get('/api/mobile/v1/advisor/sessions', { onRequest: auth }, async () => {
    available();
    return envelope({ sessions: deps.list() });
  });
  app.post('/api/mobile/v1/advisor/sessions', { onRequest: auth }, async () => {
    available();
    return envelope({ session: deps.create() });
  });
  app.get<{ Params: { id: string } }>(
    '/api/mobile/v1/advisor/sessions/:id',
    { onRequest: auth },
    async (request) => {
      available();
      if (!idSchema.safeParse(request.params.id).success)
        throw new MobileApiError('validation_error');
      const session = deps.get(request.params.id);
      if (!session) throw new MobileApiError('route_not_found');
      return envelope({ session });
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/mobile/v1/advisor/sessions/:id/messages',
    { onRequest: auth },
    async (request, reply) => {
      available();
      if (!idSchema.safeParse(request.params.id).success)
        throw new MobileApiError('validation_error');
      const body = messageSchema.safeParse(request.body);
      if (!body.success) throw new MobileApiError('validation_error');
      const session = deps.get(request.params.id);
      if (!session) throw new MobileApiError('route_not_found');
      if (!beginSessionReply(request.params.id))
        throw new MobileApiError('advisor_reply_in_progress');
      try {
        if (!deps.append(request.params.id, 'user', body.data.message))
          throw new MobileApiError('internal_server_error');

        reply.hijack();
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
          'X-Money-Monitor-Server-Id': deps.server.id,
        });
        const emit = (event: string, data: unknown) =>
          reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        let result = '';
        let chart: AdvisorChart | undefined;
        try {
          for await (const event of deps.chat([
            ...session.messages.map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: body.data.message },
          ])) {
            if (event.type === 'chart') {
              const valid = advisorChartSchema.safeParse(event.chart);
              if (valid.success) {
                chart = valid.data;
                emit('chart', { chart });
              }
            } else {
              emit(event.type, { text: event.text });
              if (event.type === 'result') result = event.text;
            }
          }
          if (result && !deps.append(request.params.id, 'assistant', result, chart))
            emit('error', { text: 'Reply could not be saved.' });
        } catch {
          emit('error', { text: 'The advisor could not finish this reply.' });
        } finally {
          reply.raw.end();
        }
      } finally {
        endSessionReply(request.params.id);
      }
    },
  );
}
