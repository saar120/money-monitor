import type { FastifyInstance } from 'fastify';
import { getModels } from '@mariozechner/pi-ai';
import type { KnownProvider } from '@mariozechner/pi-ai';
import {
  config,
  isElectronMode,
  saveConfigFile,
  configFileExists,
  SECRET_KEYS,
} from '../config.js';
import { dataDir } from '../paths.js';
import {
  hasAnthropicOAuth,
  startAnthropicOAuth,
  completeAnthropicOAuth,
  cancelAnthropicOAuth,
  PROVIDER_KEY_MAP,
} from '../ai/auth.js';
import { isDemoMode } from '../db/connection.js';

/** Settable keys (exposed in GET, writable in POST) */
const SETTABLE_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_OAUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'AI_PROVIDER',
  'AI_CHAT_MODEL',
  'AI_BATCH_PROVIDER',
  'AI_BATCH_MODEL_ID',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'CREDENTIALS_MASTER_KEY',
  'SCRAPE_CRON',
  'SCRAPE_TIMEZONE',
  'SCRAPE_START_DATE_MONTHS_BACK',
  'SCRAPE_TIMEOUT',
  'SCRAPE_SHOW_BROWSER',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_ALLOWED_USERS',
  'AI_MAX_TURNS',
] as const;

function redact(value: string): string {
  if (value.length <= 4) return '********';
  return '****' + value.slice(-4);
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', async (_request, reply) => {
    if (!isElectronMode) {
      return reply.send({
        needsSetup: false,
        isElectron: false,
        settings: {},
        dataDir: '',
        oauth: { anthropic: false },
        demoMode: isDemoMode(),
      });
    }

    const settings: Record<string, string | number | boolean> = {};

    for (const key of SETTABLE_KEYS) {
      const value = config[key];
      if (value == null) {
        settings[key] = '';
      } else if (SECRET_KEYS.has(key) && typeof value === 'string' && value.length > 0) {
        settings[key] = redact(value);
      } else {
        settings[key] = value;
      }
    }

    return reply.send({
      needsSetup: isElectronMode && !configFileExists(),
      isElectron: isElectronMode,
      settings,
      dataDir,
      oauth: { anthropic: hasAnthropicOAuth() },
      demoMode: isDemoMode(),
    });
  });

  app.post('/api/settings', async (request, reply) => {
    if (!isElectronMode) {
      return reply.status(400).send({
        error: 'Settings can only be updated in Electron mode. Edit .env for standalone mode.',
      });
    }

    const body = request.body as Record<string, unknown>;
    const updates: Record<string, string> = {};

    for (const key of SETTABLE_KEYS) {
      if (key in body) {
        updates[key] = String(body[key]);
      }
    }

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ error: 'No valid settings provided' });
    }

    try {
      saveConfigFile(updates);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      request.log.error(err, 'Failed to save config');
      return reply.status(500).send({ error: `Failed to save settings: ${msg}` });
    }
    return reply.send({ success: true });
  });

  // ── AI Provider registry ──────────────────────────────────────────────────────

  const PROVIDER_META: Record<string, { name: string; authTypes: readonly string[] }> = {
    anthropic: { name: 'Anthropic', authTypes: ['api_key', 'oauth'] },
    openai: { name: 'OpenAI', authTypes: ['api_key'] },
    google: { name: 'Google Gemini', authTypes: ['api_key'] },
    openrouter: { name: 'OpenRouter', authTypes: ['api_key'] },
  };

  const SUPPORTED_PROVIDERS = Object.entries(PROVIDER_KEY_MAP).map(([id, apiKeyField]) => ({
    id,
    apiKeyField,
    ...(PROVIDER_META[id] ?? { name: id, authTypes: ['api_key'] }),
  }));

  app.get('/api/ai/providers', async (_request, reply) => {
    const providers = SUPPORTED_PROVIDERS.map((p) => {
      const models = getModels(p.id as KnownProvider).map((m) => ({
        id: m.id,
        name: m.name,
        reasoning: m.reasoning,
      }));
      const keyValue = config[p.apiKeyField];
      return {
        ...p,
        models,
        hasKey: typeof keyValue === 'string' && keyValue.length > 0,
      };
    });
    return reply.send({ providers });
  });

  // ── OAuth endpoints ──────────────────────────────────────────────────────────

  /** Start the Anthropic PKCE OAuth flow — returns the URL the user must open. */
  app.post('/api/settings/oauth/anthropic/start', async (_request, reply) => {
    try {
      const url = await startAnthropicOAuth();
      return reply.send({ url });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  /** Complete the OAuth flow with the authorization code from the browser redirect. */
  app.post('/api/settings/oauth/anthropic/complete', async (request, reply) => {
    const { code } = request.body as { code?: string };
    if (!code) {
      return reply.status(400).send({ error: 'Authorization code is required' });
    }
    try {
      await completeAnthropicOAuth(code);
      return reply.send({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  /** Cancel any in-progress OAuth flow. */
  app.post('/api/settings/oauth/anthropic/cancel', async (_request, reply) => {
    cancelAnthropicOAuth();
    return reply.send({ success: true });
  });

  app.get('/api/settings/oauth/status', async (_request, reply) => {
    return reply.send({ anthropic: hasAnthropicOAuth() });
  });
}
