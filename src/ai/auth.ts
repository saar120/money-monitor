import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { OAuthAuth, OAuthCredentials, OAuthCredential } from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { dataDir } from '../paths.js';
import { config, isElectronMode, type Config } from '../config.js';

import { sealSecretFile, openSecretFile } from '../secret-file.js';

const CREDENTIALS_PATH = join(dataDir, 'oauth-credentials.json');

// In-memory cache of credentials keyed by provider
let credentials: Record<string, OAuthCredentials> = {};
let lastSavedJson = '';

/** Load persisted OAuth credentials from disk. */
export function loadCredentials(): void {
  try {
    const raw = readFileSync(CREDENTIALS_PATH, 'utf-8');
    const plaintext = openSecretFile(raw, config.CREDENTIALS_MASTER_KEY, isElectronMode);
    credentials = JSON.parse(plaintext);
    lastSavedJson = plaintext;
    if (raw.trimStart().startsWith('{') && Object.keys(credentials).length > 0) {
      lastSavedJson = '';
      saveCredentials();
    }
  } catch (error) {
    credentials = {};
    lastSavedJson = '';
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error('Cannot load OAuth credentials securely', { cause: error });
  }
}

/** Persist credentials to disk (skips write if unchanged). */
function saveCredentials(next = credentials): void {
  const json = JSON.stringify(next, null, 2);
  if (json === lastSavedJson) return;
  mkdirSync(dataDir, { recursive: true });
  const temporary = `${CREDENTIALS_PATH}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, sealSecretFile(json, config.CREDENTIALS_MASTER_KEY, isElectronMode), {
      mode: 0o600,
      flag: 'wx',
    });
    renameSync(temporary, CREDENTIALS_PATH);
  } finally {
    rmSync(temporary, { force: true });
  }
  credentials = next;
  lastSavedJson = json;
}
const generations = new Map<string, number>();
const currentGeneration = (provider: string) => generations.get(provider) ?? 0;
const retire = (provider: string) => {
  const next = currentGeneration(provider) + 1;
  generations.set(provider, next);
  return next;
};
const refreshes = new Map<string, { generation: number; promise: Promise<OAuthCredentials> }>();

// ── Generic OAuth flow factory ─────────────────────────────────────────────

const oauthProviders: Record<string, OAuthAuth | undefined> = {
  anthropic: anthropicProvider().auth.oauth,
  'openai-codex': openaiCodexProvider().auth.oauth,
};

export interface OAuthFlow {
  start(): Promise<string>;
  complete(code: string): Promise<void>;
  cancel(): void;
  logout(): void;
  hasOAuth(): boolean;
}

function createOAuthFlow(providerKey: string, oauth: OAuthAuth): OAuthFlow {
  type Attempt = {
    generation: number;
    controller: AbortController;
    resolve: (code: string) => void;
    reject: (cause: Error) => void;
    login: Promise<void>;
    rejectUrl: (cause: Error) => void;
    submitted: boolean;
  };
  let attempt: Attempt | null = null;
  function start(): Promise<string> {
    if (attempt) return Promise.reject(new Error('OAuth flow already in progress'));
    return new Promise<string>((resolveUrl, rejectUrl) => {
      let resolveCode!: (code: string) => void;
      let rejectCode!: (cause: Error) => void;
      const code = new Promise<string>((resolve, reject) => {
        resolveCode = resolve;
        rejectCode = reject;
      });
      void code.catch(() => {});
      const next: Attempt = {
        generation: retire(providerKey),
        controller: new AbortController(),
        resolve: resolveCode,
        reject: rejectCode,
        login: Promise.resolve(),
        rejectUrl,
        submitted: false,
      };
      attempt = next;
      next.login = Promise.resolve()
        .then(() =>
          oauth.login({
            signal: next.controller.signal,
            notify: (event) => {
              if (attempt === next && event.type === 'auth_url') resolveUrl(event.url);
            },
            prompt: (prompt) => (prompt.type === 'select' ? Promise.resolve('browser') : code),
          }),
        )
        .then((value) => {
          if (
            attempt !== next ||
            currentGeneration(providerKey) !== next.generation ||
            next.controller.signal.aborted
          )
            throw new Error('OAuth flow cancelled');
          saveCredentials({ ...credentials, [providerKey]: value });
          resolveUrl('');
        })
        .catch((cause) => {
          rejectUrl(cause);
          throw cause;
        })
        .finally(() => {
          if (attempt === next) attempt = null;
        });
      void next.login.catch(() => {});
    });
  }
  async function complete(code: string): Promise<void> {
    const current = attempt;
    if (!current) {
      if (hasOAuth()) return;
      throw new Error('No OAuth flow in progress');
    }
    if (!current.submitted) {
      current.submitted = true;
      current.resolve(code);
    }
    await current.login;
  }
  function cancel(): void {
    retire(providerKey);
    const current = attempt;
    attempt = null;
    if (!current) return;
    const error = new Error('OAuth flow cancelled');
    current.controller.abort();
    current.reject(error);
    current.rejectUrl(error);
  }
  function hasOAuth() {
    return !!credentials[providerKey]?.refresh;
  }
  function logout() {
    cancel();
    const next = { ...credentials };
    delete next[providerKey];
    saveCredentials(next);
  }
  return { start, complete, cancel, logout, hasOAuth };
}

// ── Provider flows ─────────────────────────────────────────────────────────

const anthropicFlow = createOAuthFlow('anthropic', oauthProviders.anthropic!);
const openaiCodexFlow = createOAuthFlow('openai-codex', oauthProviders['openai-codex']!);

export const startAnthropicOAuth = anthropicFlow.start;
export const completeAnthropicOAuth = anthropicFlow.complete;
export const cancelAnthropicOAuth = anthropicFlow.cancel;
export const logoutAnthropicOAuth = anthropicFlow.logout;
export const hasAnthropicOAuth = anthropicFlow.hasOAuth;

export const startOpenAICodexOAuth = openaiCodexFlow.start;
export const completeOpenAICodexOAuth = openaiCodexFlow.complete;
export const cancelOpenAICodexOAuth = openaiCodexFlow.cancel;
export const logoutOpenAICodexOAuth = openaiCodexFlow.logout;
export const hasOpenAICodexOAuth = openaiCodexFlow.hasOAuth;

/** Maps provider IDs to their config API key field names. */
export const PROVIDER_KEY_MAP: Record<string, keyof Config> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  'openai-codex': 'OPENAI_API_KEY',
  'opencode-go': 'OPENCODE_API_KEY',
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
      const oauth = oauthProviders[provider];
      if (oauth) {
        const generation = currentGeneration(provider);
        let credential: OAuthCredential = {
          ...credentials[provider],
          type: 'oauth',
        } as OAuthCredential;
        if (!credential.expires || credential.expires <= Date.now() + 60_000) {
          let refresh = refreshes.get(provider);
          if (!refresh || refresh.generation !== generation) {
            const promise = oauth.refresh(credential, new AbortController().signal);
            refresh = { generation, promise };
            refreshes.set(provider, refresh);
            void promise
              .finally(() => {
                if (refreshes.get(provider) === refresh) refreshes.delete(provider);
              })
              .catch(() => {});
          }
          const refreshed = await refresh.promise;
          if (generation !== currentGeneration(provider))
            throw new Error('OAuth credentials replaced');
          credential = { ...refreshed, type: 'oauth' } as OAuthCredential;
          saveCredentials({ ...credentials, [provider]: credential });
        }
        if (generation === currentGeneration(provider))
          return (await oauth.toAuth(credential)).apiKey;
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
