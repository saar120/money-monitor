import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { configPath } from './paths.js';

export const isElectronMode = !!process.env.MONEY_MONITOR_DATA_DIR;

// ── Config file helpers (Electron mode) ─────────────────────────────────────

export function loadConfigFile(): Record<string, string> | null {
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

export function saveConfigFile(settings: Record<string, string>): void {
  const existing = loadConfigFile() ?? {};
  const merged = { ...existing, ...settings };
  writeFileSync(configPath, JSON.stringify(merged, null, 2));
  // Update process.env so reloadConfig() picks up changes
  for (const [key, value] of Object.entries(settings)) {
    process.env[key] = String(value);
  }
  config = envSchema.parse(process.env);
}

export function configFileExists(): boolean {
  return existsSync(configPath);
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
    process.env.CREDENTIALS_MASTER_KEY = randomBytes(32).toString('hex');
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
