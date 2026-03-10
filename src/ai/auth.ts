import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loginAnthropic, getOAuthApiKey } from '@mariozechner/pi-ai/oauth';
import type { OAuthCredentials } from '@mariozechner/pi-ai/oauth';
import { dataDir } from '../paths.js';
import { config, type Config } from '../config.js';

const CREDENTIALS_PATH = join(dataDir, 'oauth-credentials.json');

// In-memory cache of credentials keyed by provider
let credentials: Record<string, OAuthCredentials> = {};

/** Load persisted OAuth credentials from disk. */
export function loadCredentials(): void {
  try {
    credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf-8'));
  } catch {
    credentials = {};
  }
}

/** Persist credentials to disk. */
function saveCredentials(): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2), { mode: 0o600 });
}

/** Run the Anthropic OAuth device code login flow. */
export async function loginWithAnthropic(): Promise<void> {
  const creds = await loginAnthropic(
    (url: string) => console.log(`[OAuth] Open this URL to authorize: ${url}`),
    async () => {
      throw new Error('Manual code input not implemented — use browser flow');
    },
  );
  credentials.anthropic = creds;
  saveCredentials();
}

/** Maps provider IDs to their config API key field names. */
export const PROVIDER_KEY_MAP: Record<string, keyof Config> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

/**
 * Get API key for a provider, auto-refreshing OAuth tokens if needed.
 * Falls back through: OAuth → CLAUDE_CODE_OAUTH_TOKEN → config API key → undefined.
 */
export async function resolveApiKey(provider: string): Promise<string | undefined> {
  // 1. Try OAuth credentials (auto-refresh)
  try {
    const result = await getOAuthApiKey(provider, credentials);
    if (result) {
      credentials[provider] = result.newCredentials;
      saveCredentials();
      return result.apiKey;
    }
  } catch (err) {
    console.error(`[OAuth] Failed to refresh token for ${provider}:`, err instanceof Error ? err.message : err);
  }

  // 2. CLAUDE_CODE_OAUTH_TOKEN fallback (anthropic only)
  if (provider === 'anthropic' && config.CLAUDE_CODE_OAUTH_TOKEN) {
    return config.CLAUDE_CODE_OAUTH_TOKEN;
  }

  // 3. Provider-specific API key from config
  const configKey = PROVIDER_KEY_MAP[provider];
  if (configKey) {
    const key = config[configKey];
    if (typeof key === 'string' && key) return key;
  }

  // 4. Undefined — pi-ai will check env vars as final fallback
  return undefined;
}

/** Check if Anthropic OAuth credentials exist. */
export function hasAnthropicOAuth(): boolean {
  return !!credentials.anthropic?.refresh;
}
