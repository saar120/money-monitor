import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loginAnthropic, loginOpenAICodex, getOAuthApiKey } from '@mariozechner/pi-ai/oauth';
import type { OAuthCredentials } from '@mariozechner/pi-ai/oauth';
import { dataDir } from '../paths.js';
import { config, type Config } from '../config.js';

const CREDENTIALS_PATH = join(dataDir, 'oauth-credentials.json');

// In-memory cache of credentials keyed by provider
let credentials: Record<string, OAuthCredentials> = {};
let lastSavedJson = '';

/** Load persisted OAuth credentials from disk. */
export function loadCredentials(): void {
  try {
    const raw = readFileSync(CREDENTIALS_PATH, 'utf-8');
    credentials = JSON.parse(raw);
    lastSavedJson = raw;
  } catch {
    credentials = {};
    lastSavedJson = '';
  }
}

/** Persist credentials to disk (skips write if unchanged). */
function saveCredentials(): void {
  const json = JSON.stringify(credentials, null, 2);
  if (json === lastSavedJson) return;
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(CREDENTIALS_PATH, json, { mode: 0o600 });
  lastSavedJson = json;
}

// ── Generic OAuth flow factory ─────────────────────────────────────────────

type LoginAdapter = (
  onUrl: (url: string) => void,
  getCode: () => Promise<string>,
) => Promise<OAuthCredentials>;

export interface OAuthFlow {
  start(): Promise<string>;
  complete(code: string): Promise<void>;
  cancel(): void;
  hasOAuth(): boolean;
}

function createOAuthFlow(providerKey: string, loginFn: LoginAdapter): OAuthFlow {
  let pendingResolve: ((code: string) => void) | null = null;
  let pendingReject: ((err: Error) => void) | null = null;
  let pendingLogin: Promise<void> | null = null;

  function start(): Promise<string> {
    if (pendingResolve) {
      throw new Error('OAuth flow already in progress');
    }

    return new Promise<string>((resolveUrl, rejectUrl) => {
      const codePromise = new Promise<string>((resolve, reject) => {
        pendingResolve = resolve;
        pendingReject = reject;
      });

      pendingLogin = loginFn(resolveUrl, () => codePromise)
        .then((creds) => {
          credentials[providerKey] = creds;
          saveCredentials();
        })
        .catch((err) => {
          rejectUrl(err);
        })
        .finally(() => {
          pendingResolve = null;
          pendingReject = null;
          pendingLogin = null;
        });
    });
  }

  async function complete(code: string): Promise<void> {
    if (!pendingResolve) {
      throw new Error('No OAuth flow in progress');
    }
    pendingResolve(code);
    if (pendingLogin) {
      await pendingLogin;
    }
  }

  function cancel(): void {
    if (pendingReject) {
      pendingReject(new Error('OAuth flow cancelled'));
    }
    pendingResolve = null;
    pendingReject = null;
    pendingLogin = null;
  }

  function hasOAuth(): boolean {
    return !!credentials[providerKey]?.refresh;
  }

  return { start, complete, cancel, hasOAuth };
}

// ── Provider flows ─────────────────────────────────────────────────────────

const anthropicFlow = createOAuthFlow('anthropic', (onUrl, getCode) =>
  loginAnthropic(onUrl, getCode),
);

const openaiCodexFlow = createOAuthFlow('openai-codex', (onUrl, getCode) =>
  loginOpenAICodex({
    onAuth: (info) => onUrl(info.url),
    onPrompt: getCode,
    onManualCodeInput: getCode,
  }),
);

export const startAnthropicOAuth = anthropicFlow.start;
export const completeAnthropicOAuth = anthropicFlow.complete;
export const cancelAnthropicOAuth = anthropicFlow.cancel;
export const hasAnthropicOAuth = anthropicFlow.hasOAuth;

export const startOpenAICodexOAuth = openaiCodexFlow.start;
export const completeOpenAICodexOAuth = openaiCodexFlow.complete;
export const cancelOpenAICodexOAuth = openaiCodexFlow.cancel;
export const hasOpenAICodexOAuth = openaiCodexFlow.hasOAuth;

/** Maps provider IDs to their config API key field names. */
export const PROVIDER_KEY_MAP: Record<string, keyof Config> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  'openai-codex': 'OPENAI_API_KEY',
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
      console.error(
        `[OAuth] Failed to refresh token for ${provider}:`,
        err instanceof Error ? err.message : err,
      );
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
