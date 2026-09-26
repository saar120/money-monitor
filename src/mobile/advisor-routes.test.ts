import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import { createMobileServer } from './mobile-server.js';
import {
  appendMessage,
  beginSessionReply,
  createSession,
  endSessionReply,
  getSession,
  listSessions,
} from '../ai/sessions.js';
import type { ChatEvent } from '../ai/agent.js';

const { dir } = vi.hoisted(() => ({
  dir: `/tmp/mm-advisor-${Math.random().toString(36).slice(2)}`,
}));
vi.mock('../paths.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../paths.js')>()),
  sessionsDir: dir,
}));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

it('authenticates, streams, saves a calculated chart, and continues a reopened chat', async () => {
  const token = 'A'.repeat(43);
  const chart = {
    kind: 'bar' as const,
    title: 'Spending by category',
    currencyCode: 'ILS' as const,
    points: [{ label: 'Groceries', value: 420 }],
  };
  let replyStarted!: () => void;
  let finishReply!: () => void;
  const started = new Promise<void>((resolve) => (replyStarted = resolve));
  const finish = new Promise<void>((resolve) => (finishReply = resolve));
  const chat = vi.fn(async function* (
    history: { role: 'user' | 'assistant'; content: string }[],
  ): AsyncGenerator<ChatEvent> {
    expect(history.at(-1)?.role).toBe('user');
    if (history.length === 5) {
      replyStarted();
      await finish;
    }
    yield { type: 'text_delta', text: 'Mac ' };
    yield {
      type: 'chart',
      chart:
        history.length === 1 ? chart : { ...chart, points: [{ label: 'Invalid', value: NaN }] },
    };
    yield { type: 'result', text: `Mac reply ${history.length}` };
  });
  const server = createMobileServer({
    logger: false,
    advisor: {
      server: { id: '11111111-1111-4111-8111-111111111111' },
      authenticator: {
        authenticate: (value) =>
          value === token
            ? {
                status: 'authenticated',
                device: {
                  id: 'phone',
                  name: 'iPhone',
                  capabilities: ['mobile.read'],
                  protocolVersion: 1,
                  tokenVersion: 1,
                  createdAt: '',
                  lastUsedAt: null,
                  expiresAt: null,
                  rotatedAt: null,
                  revokedAt: null,
                },
              }
            : { status: 'invalid' },
      },
      list: listSessions,
      create: createSession,
      get: getSession,
      append: appendMessage,
      chat,
    },
  });
  const path = '/api/mobile/v1/advisor/sessions';
  const headers = { authorization: `Bearer ${token}` };
  try {
    expect((await server.app.inject({ method: 'GET', url: path })).statusCode).toBe(401);
    const created = await server.app.inject({ method: 'POST', url: path, headers });
    expect(created.statusCode).toBe(200);
    const id = created.json().data.session.id as string;
    const first = await server.app.inject({
      method: 'POST',
      url: `${path}/${id}/messages`,
      headers,
      payload: { message: 'Show my spending' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.body).toContain('event: text_delta');
    expect(first.body).toContain('event: chart');
    const reopened = await server.app.inject({ method: 'GET', url: `${path}/${id}`, headers });
    expect(reopened.json().data.session.messages).toMatchObject([
      { role: 'user', content: 'Show my spending' },
      { role: 'assistant', content: 'Mac reply 1', chart },
    ]);
    const second = await server.app.inject({
      method: 'POST',
      url: `${path}/${id}/messages`,
      headers,
      payload: { message: 'And next?' },
    });
    expect(second.body).toContain('Mac reply 3');
    expect(second.body).not.toContain('event: chart');
    expect(chat).toHaveBeenCalledTimes(2);
    expect(getSession(id)?.messages).toHaveLength(4);
    expect(getSession(id)?.messages.at(-1)?.chart).toBeUndefined();
    expect(beginSessionReply(id)).toBe(true);
    try {
      const mobileWhileDesktopBusy = await server.app.inject({
        method: 'POST',
        url: `${path}/${id}/messages`,
        headers,
        payload: { message: 'While the Mac is replying' },
      });
      expect(mobileWhileDesktopBusy.statusCode).toBe(409);
    } finally {
      endSessionReply(id);
    }
    expect(getSession(id)?.messages).toHaveLength(4);
    const pending = server.app.inject({
      method: 'POST',
      url: `${path}/${id}/messages`,
      headers,
      payload: { message: 'A third question' },
    });
    await started;
    expect(beginSessionReply(id)).toBe(false);
    const overlap = await server.app.inject({
      method: 'POST',
      url: `${path}/${id}/messages`,
      headers,
      payload: { message: 'An overlapping question' },
    });
    expect(overlap.statusCode).toBe(409);
    expect(overlap.json().error.code).toBe('advisor_reply_in_progress');
    finishReply();
    await pending;
    expect(getSession(id)?.messages.map((message) => message.content)).toEqual([
      'Show my spending',
      'Mac reply 1',
      'And next?',
      'Mac reply 3',
      'A third question',
      'Mac reply 5',
    ]);
    writeFileSync(
      join(dir, 'legacy-invalid.jsonl'),
      JSON.stringify({ type: 'message', role: 'user', content: 'old chat', updatedAt: '' }) + '\n',
    );
    const listed = (await server.app.inject({ method: 'GET', url: path, headers })).json().data
      .sessions;
    expect(listed).toHaveLength(1);
    expect(listed[0].title).toBe('Show my spending');
  } finally {
    finishReply();
    await server.shutdown();
  }
});
