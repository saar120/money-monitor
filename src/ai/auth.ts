import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loginAnthropic, getOAuthApiKey } from '@mariozechner/pi-ai/oauth';
import type { OAuthCredentials } from '@mariozechner/pi-ai/oauth';
import { dataDir } from '../paths.js';
import { config } from '../config.js';

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

  // Migration: bootstrap from CLAUDE_CODE_OAUTH_TOKEN if no anthropic credentials yet
  if (!credentials.anthropic && config.CLAUDE_CODE_OAUTH_TOKEN) {
    credentials.anthropic = {
      access: config.CLAUDE_CODE_OAUTH_TOKEN,
      refresh: '',
      expires: 0,
    };
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

/**
 * Get API key for a provider, auto-refreshing OAuth tokens if needed.
 * Returns undefined if no OAuth credentials available (lets pi-ai fall back to env vars).
 */
export async function resolveApiKey(provider: string): Promise<string | undefined> {
  const result = await getOAuthApiKey(provider, credentials);
  if (result) {
    // Update persisted credentials if they were refreshed
    credentials[provider] = result.newCredentials;
    saveCredentials();
    return result.apiKey;
  }
  return undefined;
}

/** Check if Anthropic OAuth credentials exist. */
export function hasAnthropicOAuth(): boolean {
  return !!credentials.anthropic?.refresh;
}
