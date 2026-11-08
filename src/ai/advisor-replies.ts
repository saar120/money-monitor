import type { FastifyReply } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { advisorChartSchema, type AdvisorChart } from './advisor-chart.js';
import type { ChatEvent, ChatMessage } from './agent.js';
import { getSession, listSessions, updateSession, type Session } from './sessions.js';

export interface ReplyOperation {
  type: 'reply';
  id: string;
  sessionId: string;
  clientId: string;
  questionDigest: string;
  state: 'generating' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
  acceptedAt: string;
  finishedAt?: string;
  text?: string;
  chart?: AdvisorChart;
  error?: string;
}
export interface ReplyStore {
  get(id: string): Session | null;
  update(id: string, change: (session: Session) => Session): Session | null;
  list(): { id: string }[];
}
export class ReplyAdmissionError extends Error {
  readonly code:
    | 'not_found'
    | 'reply_in_progress'
    | 'submission_id_reused'
    | 'reply_storage_failed'
    | 'stopping';
  constructor(code: ReplyAdmissionError['code']) {
    super(code);
    this.code = code;
  }
}
export type ReplyGenerator = (
  history: ChatMessage[],
  context: { replyId: string; signal: AbortSignal },
) => AsyncIterable<ChatEvent>;
export type ReplyHandle = {
  operation: ReplyOperation;
  completion: Promise<ReplyOperation>;
  subscribe(listener: (event: ChatEvent) => void): () => void;
};
export function createAdvisorReplies(store: ReplyStore) {
  const active = new Map<string, ReplyHandle & { controller: AbortController }>();
  let accepting = true;
  function read(sessionId: string, replyId: string) {
    const reply = store.get(sessionId)?.replies?.find((reply) => reply.id === replyId) ?? null;
    if (reply?.state === 'generating' && !active.has(sessionId)) {
      const interrupted: ReplyOperation = {
        ...reply,
        state: 'interrupted',
        finishedAt: new Date().toISOString(),
        error: 'generation_interrupted',
      };
      if (
        !store.update(sessionId, (session) => ({
          ...session,
          replies: session.replies?.map((item) => (item.id === replyId ? interrupted : item)),
        }))
      )
        throw new ReplyAdmissionError('reply_storage_failed');
      return interrupted;
    }
    return reply;
  }
  function start(
    sessionId: string,
    input: { id: string; clientId: string; message: string },
    generate: ReplyGenerator,
  ): ReplyHandle {
    const session = store.get(sessionId);
    if (!session) throw new ReplyAdmissionError('not_found');
    const digest = createHash('sha256').update(input.message).digest('hex');
    const prior = session.replies?.find((reply) => reply.id === input.id);
    if (prior) {
      if (prior.clientId !== input.clientId || prior.questionDigest !== digest)
        throw new ReplyAdmissionError('submission_id_reused');
      const running = active.get(sessionId);
      if (running?.operation.id === prior.id) return running;
      const outcome = read(sessionId, prior.id)!;
      return {
        operation: outcome,
        completion: Promise.resolve(outcome),
        subscribe: () => () => {},
      };
    }
    if (!accepting) throw new ReplyAdmissionError('stopping');
    if (active.has(sessionId) || active.size >= 2)
      throw new ReplyAdmissionError('reply_in_progress');
    const now = new Date().toISOString();
    const operation: ReplyOperation = {
      type: 'reply',
      id: input.id,
      sessionId,
      clientId: input.clientId,
      questionDigest: digest,
      state: 'generating',
      acceptedAt: now,
    };
    const history = [
      ...session.messages.map(({ role, content }) => ({ role, content })),
      { role: 'user' as const, content: input.message },
    ];
    const accepted = store.update(sessionId, (value) => ({
      ...value,
      meta: {
        ...value.meta,
        updatedAt: now,
        title: value.meta.title === 'New chat' ? input.message.slice(0, 60) : value.meta.title,
      },
      messages: [
        ...value.messages,
        {
          type: 'message',
          id: `${input.id}:user`,
          role: 'user',
          content: input.message,
          timestamp: now,
        },
      ],
      replies: [...(value.replies ?? []), operation],
    }));
    if (!accepted) throw new ReplyAdmissionError('reply_storage_failed');
    const listeners = new Set<(event: ChatEvent) => void>();
    const controller = new AbortController();
    const emit = (event: ChatEvent) => {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch {
          /* An observer does not own generation. */
        }
      }
    };
    const completion = Promise.resolve()
      .then(async () => {
        let text = '';
        let chart: AdvisorChart | undefined;
        let state: ReplyOperation['state'] = 'failed';
        let error: string | undefined = 'generation_ended_without_result';
        try {
          for await (const event of generate(history, {
            replyId: input.id,
            signal: controller.signal,
          })) {
            if (controller.signal.aborted) {
              state = 'cancelled';
              error = 'generation_cancelled';
              break;
            }
            if (event.type === 'error') {
              error = 'generation_failed';
              break;
            }
            if (event.type === 'result') {
              text = event.text;
              state = 'completed';
              error = undefined;
              break;
            }
            if (event.type === 'chart') {
              const parsed = advisorChartSchema.safeParse(event.chart);
              if (!parsed.success) continue;
              chart = parsed.data;
            }
            emit(event);
          }
        } catch {
          state = controller.signal.aborted ? 'cancelled' : 'failed';
          error = state === 'cancelled' ? 'generation_cancelled' : 'generation_failed';
        }
        const outcome: ReplyOperation = {
          ...operation,
          state,
          finishedAt: new Date().toISOString(),
          ...(state === 'completed' ? { text, ...(chart ? { chart } : {}) } : {}),
          ...(error ? { error } : {}),
        };
        if (
          !store.update(sessionId, (value) => ({
            ...value,
            meta: { ...value.meta, updatedAt: outcome.finishedAt! },
            messages:
              state === 'completed'
                ? [
                    ...value.messages,
                    {
                      type: 'message',
                      id: `${input.id}:assistant`,
                      role: 'assistant',
                      content: text,
                      timestamp: outcome.finishedAt!,
                      ...(chart ? { chart } : {}),
                    },
                  ]
                : value.messages,
            replies: value.replies?.map((reply) => (reply.id === input.id ? outcome : reply)),
          }))
        )
          throw new ReplyAdmissionError('reply_storage_failed');
        return outcome;
      })
      .finally(() => {
        if (active.get(sessionId)?.operation.id === input.id) active.delete(sessionId);
        listeners.clear();
      });
    const handle = {
      operation,
      controller,
      completion,
      subscribe(listener: (event: ChatEvent) => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    active.set(sessionId, handle);
    void completion.catch(() => {});
    return handle;
  }
  return {
    read,
    start,
    busy: (id: string) => active.has(id),
    async whenIdle(id: string) {
      while (active.has(id)) await active.get(id)!.completion.catch(() => {});
    },
    pause() {
      accepting = false;
    },
    resume() {
      accepting = true;
    },
    async drain(cancel = false) {
      const runs = [...active.values()];
      if (cancel) runs.forEach((run) => run.controller.abort());
      await Promise.allSettled(runs.map((run) => run.completion));
    },
    recover() {
      for (const session of store.list())
        for (const reply of store.get(session.id)?.replies ?? [])
          if (reply.state === 'generating') read(session.id, reply.id);
    },
  };
}
export const advisorReplies = createAdvisorReplies({
  get: getSession,
  update: updateSession,
  list: listSessions,
});
export const newReplyId = randomUUID;

export async function streamAdvisorOperation(
  reply: FastifyReply,
  handle: ReplyHandle,
  serverId?: string,
) {
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...(serverId ? { 'X-Money-Monitor-Server-Id': serverId } : {}),
  });
  const emit = (type: string, data: unknown) => {
    if (!reply.raw.destroyed && !reply.raw.writableEnded)
      reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  emit('accepted', { replyId: handle.operation.id, state: handle.operation.state });
  const detach = handle.subscribe((event) =>
    emit(event.type, event.type === 'chart' ? { chart: event.chart } : { text: event.text }),
  );
  reply.raw.once('close', detach);
  try {
    const outcome = await handle.completion;
    if (outcome.chart) emit('chart', { chart: outcome.chart });
    emit(outcome.state === 'completed' ? 'result' : 'error', {
      replyId: outcome.id,
      text:
        outcome.state === 'completed'
          ? (outcome.text ?? '')
          : 'The advisor could not finish this reply.',
    });
  } catch {
    emit('error', {
      replyId: handle.operation.id,
      text: 'Reply outcome could not be saved. Check the conversation again.',
    });
  } finally {
    detach();
    reply.raw.removeListener('close', detach);
    if (!reply.raw.destroyed) reply.raw.end();
  }
}
