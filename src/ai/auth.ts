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

// ── Two-step Anthropic OAuth (PKCE) ──────────────────────────────────────────

let pendingCodeResolve: ((code: string) => void) | null = null;
let pendingLoginPromise: Promise<void> | null = null;

/**
 * Step 1: Start the Anthropic OAuth PKCE flow.
 * Returns the authorization URL the user must open in a browser.
 * The flow suspends until `completeAnthropicOAuth` is called with the code.
 */
export function startAnthropicOAuth(): Promise<string> {
  if (pendingCodeResolve) {
    throw new Error('OAuth flow already in progress');
  }

  return new Promise<string>((resolveUrl, rejectUrl) => {
    const codePromise = new Promise<string>((resolve) => {
      pendingCodeResolve = resolve;
    });

    pendingLoginPromise = loginAnthropic(
      (url: string) => resolveUrl(url),
      () => codePromise,
    ).then(creds => {
      credentials.anthropic = creds;
      saveCredentials();
    }).catch(err => {
      // If onAuthUrl never fired, reject the outer promise
      rejectUrl(err);
    }).finally(() => {
      pendingCodeResolve = null;
      pendingLoginPromise = null;
    });
  });
}

/**
 * Step 2: Complete the OAuth flow by providing the authorization code
 * the user copied from the browser redirect.
 */
export async function completeAnthropicOAuth(code: string): Promise<void> {
  if (!pendingCodeResolve) {
    throw new Error('No OAuth flow in progress');
  }
  pendingCodeResolve(code);
  if (pendingLoginPromise) {
    await pendingLoginPromise;
  }
}

/** Cancel any in-progress OAuth flow. */
export function cancelAnthropicOAuth(): void {
  pendingCodeResolve = null;
  pendingLoginPromise = null;
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
 * Falls back through: OAuth → manual OAuth token → config API key → undefined (pi-ai checks env vars).
 */
export async function resolveApiKey(provider: string): Promise<string | undefined> {
  // 1. Try OAuth credentials (auto-refresh) — only if we have stored creds for this provider
  if (credentials[provider]) {
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
  }

  // 2. Manually-pasted OAuth token (Anthropic only)
  if (provider === 'anthropic' && config.ANTHROPIC_OAUTH_TOKEN) {
    return config.ANTHROPIC_OAUTH_TOKEN;
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
