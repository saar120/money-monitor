import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { PROVIDER_KEY_MAP } from '../ai/auth.js';
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

describe('settings routes', () => {
  let server: TestServer;

  beforeEach(async () => {
    testDb = createTestDb();
    server = await createTestServer(testDb);
  });

  afterAll(async () => {
    await server?.close();
  });

  // ── GET /api/settings ──

  describe('GET /api/settings', () => {
    it('returns settings in non-electron mode', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/settings',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      // In non-electron mode, returns minimal info
      expect(body.isElectron).toBe(false);
      expect(body.needsSetup).toBe(false);
    });
  });

  // ── GET /api/ai/providers ──

  describe('GET /api/ai/providers', () => {
    it('returns supported chat providers with auth types, resolved models, and key state', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/ai/providers',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const { providers } = JSON.parse(res.body) as {
        providers: Array<{
          id: string;
          authTypes: string[];
          apiKeyField: string;
          hasKey: boolean;
          models: Array<{ id: string; name: string; reasoning: boolean }>;
        }>;
      };

      const ids = providers.map((p) => p.id);
      expect(ids).not.toContain('typesafe');
      for (const id of Object.keys(PROVIDER_KEY_MAP)) {
        expect(ids).toContain(id);
      }

      const byId = new Map(providers.map((p) => [p.id, p]));
      expect(byId.get('anthropic')?.authTypes).toEqual(['api_key', 'oauth']);
      expect(byId.get('openai-codex')?.authTypes).toEqual(['oauth']);
      for (const id of ['openai', 'opencode-go', 'google', 'openrouter']) {
        expect(byId.get(id)?.authTypes).toEqual(['api_key']);
      }

      for (const provider of providers) {
        expect(provider.hasKey).toBe(false);
        expect(provider.models.length).toBeGreaterThan(0);
        for (const model of provider.models) {
          expect(typeof model.id).toBe('string');
          expect(typeof model.name).toBe('string');
          expect(typeof model.reasoning).toBe('boolean');
        }
      }
    });
  });

  // ── POST /api/settings ──

  describe('POST /api/settings', () => {
    it('returns 400 in non-electron mode', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/settings',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { ANTHROPIC_API_KEY: 'sk-test' },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toContain('Electron mode');
    });
  });

  describe('POST /api/settings/oauth/openai-codex/logout', () => {
    it('logs out successfully even when no ChatGPT credentials are stored', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/settings/oauth/openai-codex/logout',
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true });
    });
  });

  describe('GET /api/settings/oauth/openai-codex/status', () => {
    it('reports disconnected after logout when no ChatGPT credentials are stored', async () => {
      await server.inject({
        method: 'POST',
        url: '/api/settings/oauth/openai-codex/logout',
        headers: authHeaders(),
      });
      const res = await server.inject({
        method: 'GET',
        url: '/api/settings/oauth/openai-codex/status',
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ connected: false });
    });
  });
});
