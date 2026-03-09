import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { configPath } from './paths.js';

export const isElectronMode = !!process.env.MONEY_MONITOR_DATA_DIR;

// ── Config file helpers (Electron mode) ─────────────────────────────────────

export function loadConfigFile(): Record<string, string> | null {
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (e: any) {
    if (e?.code === 'ENOENT') return null;
    console.error(`[Config] Failed to read config at ${configPath}:`, e?.message ?? e);
    throw e;
  }
}

export function saveConfigFile(settings: Record<string, string>): void {
  const existing = loadConfigFile() ?? {};
  const merged = { ...existing, ...settings };
  writeFileSync(configPath, JSON.stringify(merged, null, 2), { mode: 0o600 });
  // Update process.env and re-parse config so runtime values reflect the new settings
  for (const [key, value] of Object.entries(settings)) {
    process.env[key] = String(value);
  }
  config = envSchema.parse(process.env);
}

// ── Load config source ──────────────────────────────────────────────────────

if (!isElectronMode) {
  // Standalone: load .env from CWD
  const { config: loadDotenv } = await import('dotenv');
  loadDotenv();
} else {
  // Electron: load config.json into process.env
  const fileConfig = loadConfigFile();
  if (fileConfig) {
    for (const [key, value] of Object.entries(fileConfig)) {
      // Don't override env vars set by the Electron main process
      if (value != null && !process.env[key]) {
        process.env[key] = String(value);
      }
    }
  }
  // Auto-generate CREDENTIALS_MASTER_KEY if not set (first launch)
  if (!process.env.CREDENTIALS_MASTER_KEY) {
    const key = randomBytes(32).toString('hex');
    process.env.CREDENTIALS_MASTER_KEY = key;
    saveConfigFile({ CREDENTIALS_MASTER_KEY: key });
  }
}

// ── Zod schema ──────────────────────────────────────────────────────────────

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('127.0.0.1'),
  CREDENTIALS_MASTER_KEY: z.string().min(1, 'CREDENTIALS_MASTER_KEY is required'),
  SCRAPE_CRON: z.string().default('0 6 * * *'),
  SCRAPE_TIMEZONE: z.string().default('Asia/Jerusalem'),
  SCRAPE_START_DATE_MONTHS_BACK: z.coerce.number().default(3),
  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),
  AI_MODEL: z.string().optional(),
  AI_BATCH_MODEL: z.string().optional(),
  CLAUDE_CODE_OAUTH_TOKEN: z.string().optional(),
  API_TOKEN: z.string().optional(),
  CORS_ORIGIN: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_ALLOWED_USERS: z.string().optional(),
  SCRAPE_TIMEOUT: z.coerce.number().default(120000),
  SCRAPE_SHOW_BROWSER: z.coerce.boolean().default(false),
});

export let config = envSchema.parse(process.env);
export type Config = z.infer<typeof envSchema>;

/**
 * Parse a model spec string like "anthropic:claude-sonnet-4-6" or "openai:gpt-4o".
 * Falls back to `anthropic` provider if no colon separator is found (backward compat).
 */
export function parseModelSpec(spec: string): { provider: string; model: string } {
  const idx = spec.indexOf(':');
  if (idx === -1) return { provider: 'anthropic', model: spec };
  return { provider: spec.slice(0, idx), model: spec.slice(idx + 1) };
}

/** Resolve the effective AI model spec (AI_MODEL > ANTHROPIC_MODEL fallback). */
export function getAIModelSpec(): string {
  return config.AI_MODEL || `anthropic:${config.ANTHROPIC_MODEL}`;
}

/** Resolve the batch model spec (AI_BATCH_MODEL > AI_MODEL fallback). */
export function getBatchModelSpec(): string {
  return config.AI_BATCH_MODEL || getAIModelSpec();
}
