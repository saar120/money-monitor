import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/helpers/db.js';
import { createTestServer, authHeaders, type TestServer } from '../__tests__/helpers/server.js';

let testDb: TestDb;

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
  convertToIls: vi.fn((amount: number, currency: string, rates: Record<string, number>) => {
    if (currency === 'ILS') return amount;
    const rate = rates[currency];
    if (rate === undefined) return 0;
    return amount * rate;
  }),
}));

// ── Mock alert-settings ──
let settingsStore = getDefaults();

function getDefaults() {
  return {
    enabled: true,
    largeChargeThreshold: 500,
    unusualSpendingPercent: 30,
    monthlySummary: { enabled: true, dayOfMonth: 1 },
    reportScrapeErrors: true,
    _lastNetWorthTotal: 400000,
    _knownRecurring: ['Netflix'],
  };
}

vi.mock('../telegram/alert-settings.js', () => ({
  loadAlertSettings: () => ({ ...settingsStore }),
  updateAlertSettings: (partial: any) => {
    settingsStore = deepMerge(settingsStore, partial);
    return { ...settingsStore };
  },
  getDefaultSettings: () => ({
    enabled: true,
    largeChargeThreshold: 500,
    unusualSpendingPercent: 30,
    monthlySummary: { enabled: true, dayOfMonth: 1 },
    reportScrapeErrors: true,
  }),
  getPublicSettings: () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _lastNetWorthTotal, _knownRecurring, ...pub } = settingsStore;
    return pub;
  },
}));

vi.mock('../telegram/alerts.js', () => ({
  sendTestAlertMessage: vi.fn().mockResolvedValue(undefined),
  registerSendMessage: vi.fn(),
  registerGetChatIds: vi.fn(),
}));

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object'
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

describe('alerts routes', () => {
  let server: TestServer;

  beforeEach(async () => {
    testDb = createTestDb();
    settingsStore = getDefaults();
    server = await createTestServer(testDb);
  });

  afterAll(async () => {
    await server?.close();
  });

  // ── GET /api/alerts/settings ──

  describe('GET /api/alerts/settings', () => {
    it('returns current alert settings with new flat shape', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/alerts/settings',
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.enabled).toBe(true);
      expect(body.largeChargeThreshold).toBe(500);
      expect(body.unusualSpendingPercent).toBe(30);
      expect(body.monthlySummary.enabled).toBe(true);
      expect(body.reportScrapeErrors).toBe(true);
    });

    it('strips internal tracking fields from response', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/alerts/settings',
        headers: authHeaders(),
      });

      const body = JSON.parse(res.body);
      expect(body._lastNetWorthTotal).toBeUndefined();
      expect(body._knownRecurring).toBeUndefined();
    });
  });

  // ── PATCH /api/alerts/settings ──

  describe('PATCH /api/alerts/settings', () => {
    it('updates settings with partial merge', async () => {
      const res = await server.inject({
        method: 'PATCH',
        url: '/api/alerts/settings',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { enabled: false },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.enabled).toBe(false);
      // Other settings preserved
      expect(body.largeChargeThreshold).toBe(500);
    });

    it('deep merges nested monthlySummary settings', async () => {
      const res = await server.inject({
        method: 'PATCH',
        url: '/api/alerts/settings',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { monthlySummary: { dayOfMonth: 15 } },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.monthlySummary.dayOfMonth).toBe(15);
      expect(body.monthlySummary.enabled).toBe(true);
    });

    it('strips internal fields from response', async () => {
      const res = await server.inject({
        method: 'PATCH',
        url: '/api/alerts/settings',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { enabled: false },
      });

      const body = JSON.parse(res.body);
      expect(body._lastNetWorthTotal).toBeUndefined();
      expect(body._knownRecurring).toBeUndefined();
    });
  });

  // ── POST /api/alerts/settings/reset ──

  describe('POST /api/alerts/settings/reset', () => {
    it('resets settings to defaults', async () => {
      settingsStore.enabled = false;
      settingsStore.largeChargeThreshold = 9999;

      const res = await server.inject({
        method: 'POST',
        url: '/api/alerts/settings/reset',
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.enabled).toBe(true);
      expect(body.largeChargeThreshold).toBe(500);
    });

    it('strips internal fields from reset response', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/alerts/settings/reset',
        headers: authHeaders(),
      });

      const body = JSON.parse(res.body);
      expect(body._lastNetWorthTotal).toBeUndefined();
      expect(body._knownRecurring).toBeUndefined();
    });
  });

  // ── POST /api/alerts/test ──

  describe('POST /api/alerts/test', () => {
    it('sends a test alert and returns success', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/alerts/test',
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.message).toContain('Test alert sent');
    });
  });
});
