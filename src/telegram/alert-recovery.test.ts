import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { alertEvaluations, postImportJobs } from '../db/schema.js';
import type { AlertSettings } from './alert-settings.js';
let database: TestDb;
let server: Awaited<ReturnType<typeof import('../server.js').createServer>> | undefined;
const fixture = vi.hoisted(() => ({
  prompt: vi.fn(),
  listener: undefined as ((event: AgentEvent) => void) | undefined,
  settings: {
    enabled: true,
    largeChargeThreshold: 500,
    unusualSpendingPercent: 30,
    monthlySummary: { enabled: true, dayOfMonth: 1 },
    reportScrapeErrors: true,
    _lastNetWorthTotal: 42,
  } as AlertSettings,
  send: vi.fn(),
  confirmed: vi.fn(),
}));
vi.mock('../db/connection.js', () => ({
  get db() {
    return database.db;
  },
  get sqlite() {
    return database.sqlite;
  },
  isDemoMode: () => false,
  closeAll: vi.fn(),
}));
vi.mock('../config.js', () => ({
  config: { PORT: 0, HOST: '127.0.0.1', API_TOKEN: 'synthetic', AI_MAX_TURNS: 8 },
  getConfiguredThinkingLevel: () => 'off',
  isElectronMode: false,
  loadConfigFile: () => null,
}));
vi.mock('@earendil-works/pi-agent-core', () => ({
  Agent: class {
    subscribe(listener: (event: AgentEvent) => void) {
      fixture.listener = listener;
      return () => {
        fixture.listener = undefined;
      };
    }
    prompt = fixture.prompt;
    abort() {}
  },
}));
vi.mock('../ai/ai-utils.js', async (original) => ({
  ...(await original<typeof import('../ai/ai-utils.js')>()),
  resolveModel: () => ({ model: { reasoning: false }, provider: 'synthetic' }),
}));
vi.mock('../ai/auth.js', () => ({
  loadCredentials: vi.fn(),
  resolveApiKey: vi.fn().mockResolvedValue('synthetic'),
}));
vi.mock('../ai/sessions.js', async (original) => ({
  ...(await original<typeof import('../ai/sessions.js')>()),
  listSessions: () => [],
}));
vi.mock('../api/settings.routes.js', () => ({ settingsRoutes: async () => {} }));
vi.mock('../ai/categorization/index.js', () => ({ batchCategorize: vi.fn() }));
vi.mock('../services/net-worth.js', () => ({
  getNetWorth: vi.fn().mockResolvedValue({ total: 100 }),
}));
vi.mock('./session-map.js', () => ({
  resolveSession: () => '00000000-0000-4000-8000-000000000001',
}));
vi.mock('./alert-settings.js', () => ({
  loadAlertSettings: () => fixture.settings,
  saveAlertSettings: (next: AlertSettings) => {
    fixture.settings = next;
  },
}));
vi.mock('./bot.js', () => ({
  startTelegramBot: vi.fn(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    const alerts = await import('./alerts.js');
    alerts.registerGetChatIds(() => [123]);
    alerts.registerSendMessage(fixture.send);
    alerts.registerOnAlertSent(fixture.confirmed);
  }),
  stopTelegramBot: vi.fn().mockResolvedValue(undefined),
  restartTelegramBot: vi.fn().mockResolvedValue(undefined),
}));
const { createServer } = await import('../server.js');
const { enqueuePostImport, runPostImport, drainPostImports } =
  await import('../services/post-import.js');
const { registerGetChatIds, registerSendMessage, registerOnAlertSent, resumeAlertEvaluations } =
  await import('./alerts.js');
const { resumeTelegramDeliveries, getTelegramDelivery } = await import('./delivery.js');
const results = [
  { accountId: 1, success: true, transactionsFound: 0, transactionsNew: 0, durationMs: 1 },
];
function end(stopReason: string, text: string) {
  fixture.listener?.({
    type: 'agent_end',
    messages: [{ role: 'assistant', stopReason, content: [{ type: 'text', text }] }],
  } as unknown as AgentEvent);
}
beforeEach(() => {
  database = createTestDb();
  server = undefined;
  fixture.send.mockReset().mockResolvedValue(undefined);
  fixture.confirmed.mockReset().mockResolvedValue(undefined);
  fixture.settings = {
    ...fixture.settings,
    _lastNetWorthTotal: 42,
    _lastAlertEvaluationId: undefined,
  };
  fixture.prompt.mockReset().mockImplementation(async () => {
    end('stop', 'synthetic alert');
  });
  resumeAlertEvaluations();
  resumeTelegramDeliveries();
  registerGetChatIds(() => []);
  registerSendMessage(fixture.send);
  registerOnAlertSent(fixture.confirmed);
});
afterEach(async () => {
  await server?.shutdown();
  await drainPostImports();
  database.close();
});
it('registers authorized recipients before recovering a committed notification job on cold startup', async () => {
  const id = enqueuePostImport('synthetic-startup', [], results);
  server = await createServer();
  await server.start({ port: 0, host: '127.0.0.1' });
  await drainPostImports();
  expect(fixture.prompt).toHaveBeenCalledOnce();
  expect(database.db.select().from(alertEvaluations).get()?.key).toBe(`post-import:${id}`);
  expect(getTelegramDelivery(`post-import:${id}`, 123)?.chunks[0].state).toBe('sent');
  expect(database.db.select().from(postImportJobs).get()?.phase).toBe('finished');
  expect(fixture.send).toHaveBeenCalledOnce();
});
for (const failure of [
  'provider error',
  'rejected prompt',
  'aborted',
  'empty',
  'turn limit',
] as const) {
  it(`keeps ${failure} from the real agent adapter visible as failed analysis without advancing the baseline`, async () => {
    registerGetChatIds(() => [123]);
    fixture.prompt.mockImplementation(async () => {
      if (failure === 'rejected prompt') throw new Error('synthetic provider rejection');
      if (failure === 'turn limit') {
        for (let turn = 0; turn < 4; turn++)
          fixture.listener?.({
            type: 'turn_end',
            message: { role: 'assistant', stopReason: 'toolUse' },
          } as AgentEvent);
      } else
        end(
          failure === 'provider error' ? 'error' : failure === 'aborted' ? 'aborted' : 'stop',
          '',
        );
    });
    const id = enqueuePostImport('synthetic-failure', [], results);
    await expect(runPostImport(id)).rejects.toMatchObject({ kind: 'analysis' });
    expect(JSON.parse(database.db.select().from(alertEvaluations).get()!.payload).state).toBe(
      'failed',
    );
    expect(fixture.settings._lastNetWorthTotal).toBe(42);
    expect(fixture.settings._lastAlertEvaluationId).toBeUndefined();
    expect(fixture.send).not.toHaveBeenCalled();
    expect(fixture.confirmed).not.toHaveBeenCalled();
    expect(database.db.select().from(postImportJobs).get()?.phase).toBe('attention-needed');
  });
}
it('accepts an explicit SILENT response as a completed analysis baseline', async () => {
  registerGetChatIds(() => [123]);
  fixture.prompt.mockImplementation(async () => {
    end('stop', '[SILENT]');
  });
  const id = enqueuePostImport('synthetic-silent', [], results);
  await runPostImport(id);
  expect(JSON.parse(database.db.select().from(alertEvaluations).get()!.payload).state).toBe(
    'silent',
  );
  expect(fixture.settings._lastNetWorthTotal).toBe(100);
  expect(fixture.send).not.toHaveBeenCalled();
});
