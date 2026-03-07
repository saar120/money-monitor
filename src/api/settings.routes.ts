import type { FastifyInstance } from 'fastify';
import { execFileSync } from 'node:child_process';
import { config, isElectronMode, saveConfigFile, configFileExists } from '../config.js';
import { dataDir } from '../paths.js';

const SECRET_KEYS = new Set([
  'CREDENTIALS_MASTER_KEY',
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'API_TOKEN',
  'TELEGRAM_BOT_TOKEN',
]);

/** Settable keys (exposed in GET, writable in POST) */
const SETTABLE_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CREDENTIALS_MASTER_KEY',
  'SCRAPE_CRON',
  'SCRAPE_TIMEZONE',
  'SCRAPE_START_DATE_MONTHS_BACK',
  'SCRAPE_TIMEOUT',
  'SCRAPE_SHOW_BROWSER',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_ALLOWED_USERS',
] as const;

function redact(value: string): string {
  if (value.length <= 8) return '••••••••';
  return value.slice(0, 4) + '••••' + value.slice(-4);
}

function getClaudeStatus(): { installed: boolean; version?: string } {
  try {
    const version = execFileSync('claude', ['--version'], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    return { installed: true, version };
  } catch {
    return { installed: false };
  }
}

export async function settingsRoutes(app: FastifyInstance) {

  app.get('/api/settings', async (_request, reply) => {
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
      claude: getClaudeStatus(),
    });
  });

  app.post('/api/settings', async (request, reply) => {
    if (!isElectronMode) {
      return reply.status(400).send({ error: 'Settings can only be updated in Electron mode. Edit .env for standalone mode.' });
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

    saveConfigFile(updates);
    return reply.send({ success: true });
  });
}
