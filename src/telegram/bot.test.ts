import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import type { Session } from '../ai/sessions.js';
import type { ChatEvent } from '../ai/agent.js';
vi.unmock('./bot.js');
let database: TestDb;
const sessions = new Map<string, Session>();
const ID = '00000000-0000-4000-8000-000000000001';
const order: string[] = [];
const stop = vi.fn(async () => {
  order.push('stop');
  await new Promise((r) => setTimeout(r, 5));
  order.push('stopped');
});
const start = vi.fn(() => {
  order.push('start');
});
const send = vi.fn().mockResolvedValue(undefined);
vi.mock('grammy', async (original) => ({
  ...(await original<typeof import('grammy')>()),
  Bot: vi.fn(function (this: any) {
    Object.assign(this, {
      stop,
      start,
      catch: vi.fn(),
      use: vi.fn(),
      on: vi.fn(),
      command: vi.fn(),
      api: {
        setMyCommands: vi.fn().mockResolvedValue(undefined),
        sendMessage: send,
        sendPhoto: vi.fn().mockResolvedValue(undefined),
        sendChatAction: vi.fn().mockResolvedValue(undefined),
      },
    });
  }),
}));
vi.mock('../db/connection.js', () => ({
  get db() {
    return database.db;
  },
}));
vi.mock('../config.js', () => ({
  config: { TELEGRAM_BOT_TOKEN: 'synthetic-token', TELEGRAM_ALLOWED_USERS: '123,456' },
}));
vi.mock('../ai/agent.js', () => ({ chat: vi.fn() }));
vi.mock('../ai/memory.js', () => ({ readMemory: vi.fn() }));
vi.mock('../ai/sessions.js', () => ({
  getSession: (id: string) => sessions.get(id) ?? null,
  updateSession: (id: string, change: (session: Session) => Session) => {
    const value = sessions.get(id);
    if (!value) return null;
    const next = change(structuredClone(value));
    sessions.set(id, next);
    return next;
  },
  listSessions: () => [...sessions.values()].map((s) => s.meta),
}));
vi.mock('./session-map.js', () => ({
  getSessionId: vi.fn(),
  setSessionId: vi.fn(),
  clearSessionId: vi.fn(),
  getAllChatIds: vi.fn().mockReturnValue([]),
  resolveSession: vi.fn(() => ID),
}));
vi.mock('./alerts.js', () => ({
  registerSendMessage: vi.fn(),
  registerGetChatIds: vi.fn(),
  registerOnAlertSent: vi.fn(),
  retryAlertDelivery: vi.fn(),
}));
const bot = await import('./bot.js');
const { Bot } = await import('grammy');
const { chat } = await import('../ai/agent.js');
const { advisorReplies } = await import('../ai/advisor-replies.js');
const { getAllChatIds, resolveSession } = await import('./session-map.js');
const { registerGetChatIds, registerOnAlertSent } = await import('./alerts.js');
const { resumeTelegramDeliveries } = await import('./delivery.js');
function newSession(id = ID) {
  sessions.set(id, {
    meta: { type: 'meta', id, title: 'New chat', createdAt: '', updatedAt: '' },
    messages: [],
  });
}
function instance() {
  return vi.mocked(Bot).mock.instances.at(-1)!;
}
function handler(name: string) {
  return vi.mocked(instance().on).mock.calls.find(([event]) => event === name)![1] as (
    ctx: any,
  ) => Promise<void>;
}
function context(update_id = 1) {
  return {
    chat: { id: 123, type: 'private' },
    update: { update_id, message: { text: 'synthetic question' } },
    message: { text: 'synthetic question' },
    reply: vi.fn().mockResolvedValue(undefined),
  };
}
beforeEach(async () => {
  await bot.stopTelegramBot();
  database = createTestDb();
  sessions.clear();
  newSession();
  advisorReplies.resume();
  resumeTelegramDeliveries();
  order.length = 0;
  stop.mockClear();
  start.mockClear();
  send.mockReset().mockResolvedValue(undefined);
  vi.mocked(resolveSession).mockReturnValue(ID);
  vi.mocked(chat).mockClear();
  vi.mocked(chat).mockImplementation(async function* (): AsyncGenerator<ChatEvent> {
    yield { type: 'result', text: 'synthetic answer' };
  });
});
afterEach(async () => {
  vi.useRealTimers();
  await bot.stopTelegramBot();
  await advisorReplies.drain(true);
  database.close();
  vi.useRealTimers();
});
describe('Telegram polling and reply ownership', () => {
  it('coalesces concurrent starts and restarts, awaiting the old poller before starting one replacement', async () => {
    await Promise.all([bot.startTelegramBot(), bot.startTelegramBot()]);
    expect(start).toHaveBeenCalledOnce();
    order.length = 0;
    await Promise.all([bot.restartTelegramBot(), bot.restartTelegramBot()]);
    expect(order).toEqual(['stop', 'stopped', 'start']);
    const restart = bot.restartTelegramBot();
    const stopping = bot.stopTelegramBot();
    await Promise.all([restart, stopping]);
    expect(order.at(-1)).toBe('stopped');
  });
  it('does not start another poller after a stop failure', async () => {
    await bot.startTelegramBot();
    stop.mockRejectedValueOnce(new Error('synthetic stop failure'));
    await expect(bot.restartTelegramBot()).rejects.toThrow('stop failure');
    expect(start).toHaveBeenCalledOnce();
  });
  it('replays a duplicated update once using its original session even after a session switch', async () => {
    await bot.startTelegramBot();
    const handle = handler('message:text');
    const ctx = context();
    await Promise.all([handle(ctx), handle(ctx)]);
    newSession('00000000-0000-4000-8000-000000000002');
    vi.mocked(resolveSession).mockReturnValue('00000000-0000-4000-8000-000000000002');
    await handle(ctx);
    expect(chat).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    expect(sessions.get(ID)?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(sessions.get('00000000-0000-4000-8000-000000000002')?.messages).toEqual([]);
  });
  it('shares reply admission with desktop/mobile and persists no competing Telegram question', async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const desktop = advisorReplies.start(
      ID,
      { id: 'desktop-reply', clientId: 'desktop', message: 'desktop question' },
      async function* () {
        await waiting;
        yield { type: 'result', text: 'desktop answer' };
      },
    );
    await bot.startTelegramBot();
    await handler('message:text')(context());
    expect(chat).not.toHaveBeenCalled();
    expect(sessions.get(ID)?.messages.map((m) => m.content)).toEqual(['desktop question']);
    expect(send).toHaveBeenCalledWith(123, expect.stringContaining('busy'), expect.anything());
    release();
    await desktop.completion;
  });
  it('records confirmed alert context once in the captured session after its active reply settles', async () => {
    await bot.startTelegramBot();
    const confirmed = vi.mocked(registerOnAlertSent).mock.calls.at(-1)![0];
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const active = advisorReplies.start(
      ID,
      { id: 'reply', clientId: 'phone', message: 'question' },
      async function* () {
        await waiting;
        yield { type: 'result', text: 'answer' };
      },
    );
    const identity = { operationId: 'alert-a', sessionId: ID };
    const recording = confirmed(123, 'alert', 'seed', identity);
    await Promise.resolve();
    expect(sessions.get(ID)?.messages).toHaveLength(1);
    release();
    await active.completion;
    await recording;
    await confirmed(123, 'alert', 'seed', identity);
    expect(sessions.get(ID)?.messages.map((m) => m.content)).toEqual([
      'question',
      'answer',
      'seed',
      'alert',
    ]);
  });
  it('stops typing while an action is in flight without scheduling a late timer', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const action = vi.fn(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    );
    const stopTyping = bot.startTypingLoop(123, { sendChatAction: action } as any, () => true);
    stopTyping();
    finish();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(action).toHaveBeenCalledOnce();
  });
  it('rejects groups and filters alert destinations against the current allowlist', async () => {
    vi.mocked(getAllChatIds).mockReturnValue([123, -456, 999]);
    await bot.startTelegramBot();
    const middleware = vi.mocked(instance().use).mock.calls.at(-1)![0] as (
      ctx: any,
      next: () => void,
    ) => Promise<void>;
    const next = vi.fn();
    await middleware({ from: { id: 123 }, chat: { id: -456, type: 'group' } }, next);
    await middleware({ from: { id: 999 }, chat: { id: 999, type: 'private' } }, next);
    expect(next).not.toHaveBeenCalled();
    await middleware({ from: { id: 123 }, chat: { id: 123, type: 'private' } }, next);
    expect(next).toHaveBeenCalledOnce();
    expect(vi.mocked(registerGetChatIds).mock.calls.at(-1)![0]()).toEqual([123]);
  });
});
