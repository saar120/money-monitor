import { rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import Fastify from 'fastify';
import { afterAll, expect, it, vi } from 'vitest';
import { aiRoutes } from './ai.routes.js';
import { getSession } from '../ai/sessions.js';

const { dir, chat } = vi.hoisted(() => ({
  dir: `/tmp/mm-desktop-advisor-${Math.random().toString(36).slice(2)}`,
  chat: vi.fn(),
}));
vi.mock('../paths.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../paths.js')>()),
  sessionsDir: dir,
}));
vi.mock('../ai/agent.js', () => ({
  chat,
  batchCategorize: vi.fn(),
  recategorize: vi.fn(),
}));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

it('streams and saves a valid desktop Advisor chart', async () => {
  const chart = {
    kind: 'bar',
    title: 'Spending by category',
    currencyCode: 'ILS',
    points: [{ label: 'Groceries', value: 420 }],
  };
  chat.mockImplementation(async function* () {
    yield { type: 'chart', chart };
    yield { type: 'result', text: 'Here is your spending.' };
  });
  const app = Fastify({ logger: false });
  await app.register(aiRoutes);
  try {
    const created = await app.inject({ method: 'POST', url: '/api/ai/sessions' });
    const id = created.json().session.id as string;
    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/chat',
      payload: { sessionId: id, message: 'Show my spending' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('event: chart');
    expect(getSession(id)?.messages).toMatchObject([
      { role: 'user', content: 'Show my spending' },
      { role: 'assistant', content: 'Here is your spending.', chart },
    ]);
    chat.mockImplementation(async function* () {
      yield { type: 'chart', chart };
      yield { type: 'result', text: '' };
    });
    const chartOnly = await app.inject({
      method: 'POST',
      url: '/api/ai/chat',
      payload: { sessionId: id, message: 'Show a chart only' },
    });
    expect(chartOnly.body).toContain('event: chart');
    expect(getSession(id)?.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: '',
      chart,
    });
  } finally {
    await app.close();
  }
});

it('drops a question whose reply failed, so a retry does not save it twice', async () => {
  const app = Fastify({ logger: false });
  await app.register(aiRoutes);
  try {
    const created = await app.inject({ method: 'POST', url: '/api/ai/sessions' });
    const id = created.json().session.id as string;
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/api/ai/chat',
        payload: { sessionId: id, message: 'Show my spending' },
      });
    chat.mockImplementation(async function* () {
      yield { type: 'error', text: 'Provider unavailable' };
    });
    expect((await send()).body).toContain('event: error');
    expect(getSession(id)?.messages).toEqual([]);
    expect(getSession(id)?.meta.title).toBe('New chat');
    chat.mockImplementation(async function* () {
      yield { type: 'status', text: 'Working' };
      throw new Error('Connection lost');
    });
    expect((await send()).body).toContain('Connection lost');
    expect(getSession(id)?.messages).toEqual([]);
    chat.mockImplementation(async function* () {
      yield { type: 'result', text: 'Here it is.' };
    });
    await send();
    expect(getSession(id)?.messages).toMatchObject([
      { role: 'user', content: 'Show my spending' },
      { role: 'assistant', content: 'Here it is.' },
    ]);
  } finally {
    await app.close();
  }
});

it('rejects encoded traversal without reading or deleting files outside sessions', async () => {
  mkdirSync(dir, { recursive: true });
  const victim = `${dir}-outside.jsonl`;
  writeFileSync(victim, JSON.stringify({ type: 'meta', id: 'synthetic', title: 'private' }) + '\n');
  const app = Fastify();
  await app.register(aiRoutes);
  try {
    const name = victim
      .split('/')
      .at(-1)!
      .replace(/\.jsonl$/, '');
    for (const method of ['GET', 'DELETE'] as const) {
      const response = await app.inject({ method, url: `/api/ai/sessions/..%2F${name}` });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain('private');
      expect(existsSync(victim)).toBe(true);
    }
    expect(getSession(`../${name}`)).toBeNull();
  } finally {
    await app.close();
    rmSync(victim, { force: true });
  }
});
