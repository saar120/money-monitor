import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Undo the global setup mock so we test the REAL bot.ts lifecycle ──
vi.unmock('./bot.js');

// ── Track call order to verify no race condition ──
const callOrder: string[] = [];

const mockStop = vi.fn(() => {
  callOrder.push('bot.stop:called');
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      callOrder.push('bot.stop:resolved');
      resolve();
    }, 50);
  });
});

const mockStart = vi.fn((_opts?: any) => {
  callOrder.push('bot.start');
});

vi.mock('grammy', () => {
  const MockBot = vi.fn(function (this: any) {
    this.stop = mockStop;
    this.start = mockStart;
    this.catch = vi.fn();
    this.use = vi.fn();
    this.on = vi.fn();
    this.command = vi.fn();
    this.api = { setMyCommands: vi.fn().mockReturnValue({ catch: vi.fn() }) };
  });
  return { Bot: MockBot };
});

vi.mock('../config.js', () => ({
  config: {
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_ALLOWED_USERS: '123',
  },
}));

vi.mock('../ai/agent.js', () => ({ chat: vi.fn() }));
vi.mock('../ai/memory.js', () => ({ readMemory: vi.fn() }));
vi.mock('../ai/sessions.js', () => ({
  createSession: vi.fn().mockReturnValue('session-1'),
  listSessions: vi.fn().mockReturnValue([]),
  appendMessage: vi.fn(),
  getSessionMessages: vi.fn().mockReturnValue([]),
}));
vi.mock('./session-map.js', () => ({
  getSessionId: vi.fn(),
  setSessionId: vi.fn(),
  clearSessionId: vi.fn(),
  getAllChatIds: vi.fn().mockReturnValue([]),
}));
vi.mock('./format.js', () => ({
  markdownToTelegramHtml: vi.fn((s: string) => s),
  splitMessage: vi.fn((s: string) => [s]),
}));
vi.mock('./alerts.js', () => ({
  registerSendMessage: vi.fn(),
  registerGetChatIds: vi.fn(),
  registerOnAlertSent: vi.fn(),
}));

const botModule = await import('./bot.js');

describe('Telegram bot restart race condition', () => {
  beforeEach(async () => {
    callOrder.length = 0;
    mockStop.mockClear();
    mockStart.mockClear();
    await botModule.stopTelegramBot();
    callOrder.length = 0;
  });

  it('stopTelegramBot awaits bot.stop() before returning', async () => {
    botModule.startTelegramBot();
    expect(mockStart).toHaveBeenCalledOnce();

    await botModule.stopTelegramBot();

    expect(callOrder).toContain('bot.stop:called');
    expect(callOrder).toContain('bot.stop:resolved');
  });

  it('restartTelegramBot: new bot.start() only fires after old bot.stop() fully resolves', async () => {
    botModule.startTelegramBot();
    callOrder.length = 0;

    await botModule.restartTelegramBot();

    // Sequence MUST be: stop:called → stop:resolved → start
    // If stop were fire-and-forget, 'bot.start' would appear before 'bot.stop:resolved'
    const stopCalledIdx = callOrder.indexOf('bot.stop:called');
    const stopResolvedIdx = callOrder.indexOf('bot.stop:resolved');
    const startIdx = callOrder.lastIndexOf('bot.start');

    expect(stopCalledIdx).toBeGreaterThanOrEqual(0);
    expect(stopResolvedIdx).toBeGreaterThanOrEqual(0);
    expect(startIdx).toBeGreaterThanOrEqual(0);

    expect(stopCalledIdx).toBeLessThan(stopResolvedIdx);
    expect(stopResolvedIdx).toBeLessThan(startIdx);
  });

  it('fire-and-forget stop() causes start to race ahead (regression proof)', async () => {
    // Demonstrates why the OLD code was broken: calling stop() without
    // await lets start() run before stop's cleanup getUpdates finishes.
    const raceOrder: string[] = [];

    const stopPromise = mockStop();
    void stopPromise.then(() => raceOrder.push('stop:resolved'));
    raceOrder.push('start:called');

    await new Promise((r) => setTimeout(r, 100));

    expect(raceOrder[0]).toBe('start:called');
    expect(raceOrder[1]).toBe('stop:resolved');
  });
});
