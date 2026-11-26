import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { authHeaders, type TestServer } from '../__tests__/helpers/server.js';

let testDb: TestDb;
let tempDataDir = '';
const mockSendTestAlertMessage = vi.fn();

vi.mock('../paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../paths.js')>();
  return {
    ...actual,
    get dataDir() {
      return tempDataDir;
    },
    get dbPath() {
      return join(tempDataDir, 'finance.db');
    },
    get demoDbPath() {
      return join(tempDataDir, 'demo.db');
    },
    get credentialsPath() {
      return join(tempDataDir, 'credentials.enc');
    },
    get configFilePath() {
      return join(tempDataDir, 'config.json');
    },
    get chatDir() {
      return join(tempDataDir, 'chat');
    },
    get sessionsDir() {
      return join(tempDataDir, 'sessions');
    },
  };
});

vi.mock('../db/connection.js', () => ({
  get db() {
    return testDb.db;
  },
  get sqlite() {
    return testDb.sqlite;
  },
  isDemoMode: () => false,
  closeAll: () => {},
}));

vi.mock('../scraper/credential-store.js', () => ({
  getStoredCredentials: vi.fn().mockResolvedValue([]),
  storeCredentials: vi.fn().mockResolvedValue(undefined),
  deleteCredentials: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../scraper/scraper.service.js', () => ({
  MANUAL_LOGIN_COMPANIES: new Set(),
  startScraping: vi.fn(),
}));

vi.mock('../services/exchange-rates.js', () => ({
  getExchangeRates: vi.fn().mockResolvedValue({
    rates: { ILS: 1, USD: 3.6, EUR: 3.9 },
    stale: false,
    fetchedAt: new Date().toISOString(),
  }),
  convertToIls: vi.fn((amount: number) => amount),
}));

vi.mock('../telegram/alerts.js', () => ({
  sendTestAlertMessage: mockSendTestAlertMessage,
  registerSendMessage: vi.fn(),
  registerGetChatIds: vi.fn(),
}));

describe('alerts routes', () => {
  let server: TestServer;

  beforeEach(async () => {
    vi.resetModules();
    mockSendTestAlertMessage.mockReset().mockResolvedValue(undefined);
    tempDataDir = mkdtempSync(join(tmpdir(), 'mm-alerts-routes-'));
    testDb = createTestDb();
    const { createTestServer } = await import('../__tests__/helpers/server.js');
    server = await createTestServer(testDb);
  });

  afterEach(async () => {
    await server?.close();
    testDb?.close();
    rmSync(tempDataDir, { recursive: true, force: true });
  });

  it('GET /api/alerts/settings returns real public default settings without internal keys', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/alerts/settings',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toEqual({
      enabled: true,
      largeChargeThreshold: 500,
      unusualSpendingPercent: 30,
      monthlySummary: { enabled: true, dayOfMonth: 1 },
      reportScrapeErrors: true,
    });
  });

  it('PATCH /api/alerts/settings persists allowed fields and ignores internal or mistyped keys', async () => {
    const { loadAlertSettings } = await import('../telegram/alert-settings.js');
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/alerts/settings',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: {
        enabled: false,
        largeChargeThreshold: 'not-a-number',
        monthlySummary: { dayOfMonth: 15, enabled: 'invalid' },
        _lastNetWorthTotal: 999999,
        _knownRecurring: ['Injected'],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      enabled: false,
      largeChargeThreshold: 500,
      unusualSpendingPercent: 30,
      monthlySummary: { enabled: true, dayOfMonth: 15 },
      reportScrapeErrors: true,
    });
    expect(loadAlertSettings()._lastNetWorthTotal).toBeUndefined();
    expect(loadAlertSettings()._knownRecurring).toBeUndefined();
  });

  it('POST /api/alerts/settings/reset restores default public settings', async () => {
    await server.inject({
      method: 'PATCH',
      url: '/api/alerts/settings',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { enabled: false, largeChargeThreshold: 9999 },
    });

    const res = await server.inject({
      method: 'POST',
      url: '/api/alerts/settings/reset',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      enabled: true,
      largeChargeThreshold: 500,
    });
  });

  it('POST /api/alerts/test maps success and send errors', async () => {
    const ok = await server.inject({
      method: 'POST',
      url: '/api/alerts/test',
      headers: authHeaders(),
    });
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ success: true, message: 'Test alert sent' });

    mockSendTestAlertMessage.mockRejectedValueOnce(new Error('Telegram offline'));
    const failed = await server.inject({
      method: 'POST',
      url: '/api/alerts/test',
      headers: authHeaders(),
    });
    expect(failed.statusCode).toBe(500);
    expect(JSON.parse(failed.body)).toEqual({ error: 'Telegram offline' });
  });
});
