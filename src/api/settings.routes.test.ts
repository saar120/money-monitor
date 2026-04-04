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
    it('returns supported providers with models', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/ai/providers',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.providers).toBeInstanceOf(Array);
      expect(body.providers.length).toBe(5);

      const anthropic = body.providers.find((p: any) => p.id === 'anthropic');
      expect(anthropic).toBeDefined();
      expect(anthropic.name).toBe('Anthropic');
      expect(anthropic.models.length).toBeGreaterThan(0);
      expect(anthropic.models[0]).toHaveProperty('id');
      expect(anthropic.models[0]).toHaveProperty('name');

      const openai = body.providers.find((p: any) => p.id === 'openai');
      expect(openai).toBeDefined();
      expect(openai.hasKey).toBe(false); // no key in test env
    });

    it('includes all providers with correct metadata', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/ai/providers',
        headers: authHeaders(),
      });
      const { providers } = JSON.parse(res.body);

      const ids = providers.map((p: any) => p.id);
      expect(ids).toEqual(['anthropic', 'openai', 'openai-codex', 'google', 'openrouter']);

      // Anthropic supports both API key and OAuth
      const anthropic = providers.find((p: any) => p.id === 'anthropic');
      expect(anthropic.authTypes).toEqual(['api_key', 'oauth']);
      expect(anthropic.apiKeyField).toBe('ANTHROPIC_API_KEY');

      // OpenAI Codex supports OAuth only
      const codex = providers.find((p: any) => p.id === 'openai-codex');
      expect(codex.authTypes).toEqual(['oauth']);
      expect(codex.apiKeyField).toBe('OPENAI_API_KEY');

      // Other providers support API key only
      for (const id of ['openai', 'google', 'openrouter']) {
        const p = providers.find((x: any) => x.id === id);
        expect(p.authTypes).toEqual(['api_key']);
      }
    });

    it('each model has id, name, and reasoning fields', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/ai/providers',
        headers: authHeaders(),
      });
      const { providers } = JSON.parse(res.body);

      for (const provider of providers) {
        expect(provider.models.length).toBeGreaterThan(0);
        for (const model of provider.models) {
          expect(model).toHaveProperty('id');
          expect(model).toHaveProperty('name');
          expect(model).toHaveProperty('reasoning');
          expect(typeof model.reasoning).toBe('boolean');
        }
      }
    });

    it('reports hasKey false when no API keys configured', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/ai/providers',
        headers: authHeaders(),
      });
      const { providers } = JSON.parse(res.body);

      // All keys are empty in test mock config
      for (const provider of providers) {
        expect(provider.hasKey).toBe(false);
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
});
