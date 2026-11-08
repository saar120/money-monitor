import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ChatEvent, ChatMessage } from '../ai/agent.js';
import type { AdvisorChart } from '../ai/advisor-chart.js';
import {
  ReplyAdmissionError,
  streamAdvisorOperation,
  type advisorReplies,
} from '../ai/advisor-replies.js';
import type { Session, SessionMeta, SessionSummary } from '../ai/sessions.js';
import { MobileApiError, createMobileSuccessEnvelope } from './contract.js';
import {
  createMobileAuthenticationHook,
  type MobileCredentialAuthenticator,
} from './mobile-auth.js';

const idSchema = z.uuid();
const messageSchema = z
  .object({
    submissionId: z.string().uuid().optional(),
    message: z.string().trim().min(1).max(4000),
  })
  .strict();

export interface MobileAdvisorDependencies {
  authenticator: MobileCredentialAuthenticator;
  server: { id: string };
  available?: () => boolean;
  list(): SessionSummary[];
  create(id?: string): SessionMeta;
  get(id: string): Session | null;
  append(id: string, role: 'user' | 'assistant', content: string, chart?: AdvisorChart): unknown;
  replies?: typeof advisorReplies;
  chat(
    history: ChatMessage[],
    context?: { replyId: string; signal: AbortSignal },
  ): AsyncGenerator<ChatEvent>;
}

export function registerMobileAdvisorRoutes(
  app: FastifyInstance,
  deps: MobileAdvisorDependencies,
  clock: () => Date,
) {
  const auth = createMobileAuthenticationHook(deps.authenticator, 'mobile.read');
  const requests = new Map<string, { start: number; count: number }>();
  const limit = (deviceId: string) => {
    const now = clock().getTime();
    for (const [id, window] of requests) if (now - window.start >= 60_000) requests.delete(id);
    const window = requests.get(deviceId) ?? { start: now, count: 0 };
    if (window.count >= 10 || (!requests.has(deviceId) && requests.size >= 1000))
      throw new MobileApiError('rate_limited');
    window.count++;
    requests.set(deviceId, window);
  };
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
  app.post('/api/mobile/v1/advisor/sessions', { onRequest: auth }, async (request) => {
    available();
    limit(request.mobileDevice!.id);
    const input = z.object({ id: idSchema.optional() }).safeParse(request.body ?? {});
    if (!input.success) throw new MobileApiError('validation_error');
    return envelope({ session: deps.create(input.data.id) });
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
  app.get<{ Params: { id: string; replyId: string } }>(
    '/api/mobile/v1/advisor/sessions/:id/replies/:replyId',
    { onRequest: auth },
    async (request) => {
      available();
      if (
        !idSchema.safeParse(request.params.id).success ||
        !idSchema.safeParse(request.params.replyId).success
      )
        throw new MobileApiError('validation_error');
      const operation = deps.replies?.read(request.params.id, request.params.replyId);
      if (!operation) throw new MobileApiError('route_not_found');
      return envelope({ reply: operation });
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
      if (!body.data.submissionId || !deps.replies) throw new MobileApiError('upgrade_required');
      limit(request.mobileDevice!.id);
      try {
        const operation = deps.replies.start(
          request.params.id,
          {
            id: body.data.submissionId,
            clientId: request.mobileDevice!.id,
            message: body.data.message,
          },
          (history, context) => deps.chat(history, context),
        );
        return await streamAdvisorOperation(reply, operation, deps.server.id);
      } catch (cause) {
        if (cause instanceof ReplyAdmissionError)
          throw new MobileApiError(
            cause.code === 'not_found'
              ? 'route_not_found'
              : cause.code === 'reply_in_progress'
                ? 'advisor_reply_in_progress'
                : cause.code === 'submission_id_reused'
                  ? 'command_id_reused'
                  : 'internal_server_error',
          );
        throw cause;
      }
    },
  );
}
