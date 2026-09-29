import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockRefresh = vi.fn();
const mockToAuth = vi.fn();
const mockOAuth = { login: vi.fn(), refresh: mockRefresh, toAuth: mockToAuth };
vi.mock('@earendil-works/pi-ai/providers/anthropic', () => ({
  anthropicProvider: () => ({ auth: { oauth: mockOAuth } }),
}));
vi.mock('@earendil-works/pi-ai/providers/openai-codex', () => ({
  openaiCodexProvider: () => ({ auth: { oauth: mockOAuth } }),
}));

// Mock paths
vi.mock('../paths.js', () => ({
  dataDir: '/tmp/test-auth',
}));

// Mock filesystem (prevent actual disk writes)
const mockReadFileSync = vi.fn().mockReturnValue('{}');
const mockWriteFileSync = vi.fn();
vi.mock('node:fs', () => ({
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: vi.fn(),
}));

// Controllable config for testing
const mockConfig: Record<string, any> = {};

vi.mock('../config.js', () => ({
  get config() {
    return mockConfig;
  },
  isElectronMode: false,
  loadConfigFile: () => null,
  saveConfigFile: vi.fn(),
}));

// Import after all mocks are set up
const {
  resolveApiKey,
  PROVIDER_KEY_MAP,
  loadCredentials,
  completeOpenAICodexOAuth,
  startOpenAICodexOAuth,
  logoutOpenAICodexOAuth,
  hasOpenAICodexOAuth,
} = await import('./auth.js');

function resetConfig() {
  Object.assign(mockConfig, {
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_OAUTH_TOKEN: undefined,
    OPENAI_API_KEY: '',
    OPENCODE_API_KEY: '',
    GEMINI_API_KEY: '',
    OPENROUTER_API_KEY: '',
  });
}

// ── PROVIDER_KEY_MAP ─────────────────────────────────────────────────────────

describe('PROVIDER_KEY_MAP', () => {
  it('maps all supported providers to config fields', () => {
    expect(PROVIDER_KEY_MAP).toEqual({
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      'openai-codex': 'OPENAI_API_KEY',
      'opencode-go': 'OPENCODE_API_KEY',
      google: 'GEMINI_API_KEY',
      openrouter: 'OPENROUTER_API_KEY',
    });
  });
});

// ── resolveApiKey ────────────────────────────────────────────────────────────

describe('resolveApiKey', () => {
  beforeEach(() => {
    resetConfig();
    mockRefresh.mockReset();
    mockToAuth.mockReset();
    mockReadFileSync.mockReturnValue('{}');
    mockWriteFileSync.mockReset();
    loadCredentials(); // resets internal credentials to {}
  });

  it('returns OAuth API key when available (step 1)', async () => {
    // Seed credentials so the OAuth branch is entered
    mockReadFileSync.mockReturnValue(JSON.stringify({ anthropic: { refresh: 'existing-tok' } }));
    loadCredentials();
    mockRefresh.mockResolvedValue({
      type: 'oauth',
      access: 'oauth-key-123',
      refresh: 'tok',
      expires: Date.now() + 3600000,
    });
    mockToAuth.mockImplementation(async (credential) => ({ apiKey: credential.access }));
    expect(await resolveApiKey('anthropic')).toBe('oauth-key-123');
    expect(mockRefresh).toHaveBeenCalledOnce();
  });

  it('falls through to ANTHROPIC_OAUTH_TOKEN for anthropic (step 2)', async () => {
    mockConfig.ANTHROPIC_OAUTH_TOKEN = 'oat-test-token';
    expect(await resolveApiKey('anthropic')).toBe('oat-test-token');
  });

  it('skips ANTHROPIC_OAUTH_TOKEN for non-anthropic providers', async () => {
    mockConfig.ANTHROPIC_OAUTH_TOKEN = 'oat-test-token';
    mockConfig.OPENAI_API_KEY = 'sk-openai';
    expect(await resolveApiKey('openai')).toBe('sk-openai');
  });

  it('returns config API key when OAuth fails (step 3)', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ anthropic: { refresh: 'expired' } }));
    loadCredentials();
    mockRefresh.mockRejectedValue(new Error('OAuth expired'));
    mockConfig.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(await resolveApiKey('anthropic')).toBe('sk-ant-test');
  });

  it('returns config key for each provider', async () => {
    mockConfig.OPENAI_API_KEY = 'sk-openai';
    expect(await resolveApiKey('openai')).toBe('sk-openai');

    mockConfig.GEMINI_API_KEY = 'gem-key';
    expect(await resolveApiKey('google')).toBe('gem-key');

    mockConfig.OPENROUTER_API_KEY = 'or-key';
    expect(await resolveApiKey('openrouter')).toBe('or-key');

    mockConfig.OPENCODE_API_KEY = 'opencode-go-key';
    expect(await resolveApiKey('opencode-go')).toBe('opencode-go-key');
  });

  it('returns undefined when no key is available (step 4)', async () => {
    expect(await resolveApiKey('anthropic')).toBeUndefined();
  });

  it('returns undefined for unknown provider', async () => {
    expect(await resolveApiKey('unknown-provider')).toBeUndefined();
  });

  it('skips empty string config keys', async () => {
    mockConfig.ANTHROPIC_API_KEY = '';
    expect(await resolveApiKey('anthropic')).toBeUndefined();
  });
});

describe('OAuth logout', () => {
  beforeEach(() => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        anthropic: { refresh: 'anthropic-refresh' },
        'openai-codex': { refresh: 'openai-refresh' },
      }),
    );
    mockWriteFileSync.mockReset();
    loadCredentials();
  });

  it('removes only the ChatGPT credentials and persists the change', () => {
    expect(hasOpenAICodexOAuth()).toBe(true);

    logoutOpenAICodexOAuth();

    expect(hasOpenAICodexOAuth()).toBe(false);
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/tmp/test-auth/oauth-credentials.json',
      JSON.stringify({ anthropic: { refresh: 'anthropic-refresh' } }, null, 2),
      { mode: 0o600 },
    );
  });

  it('is safe to call when already logged out', () => {
    logoutOpenAICodexOAuth();
    mockWriteFileSync.mockClear();

    logoutOpenAICodexOAuth();

    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});

describe('OAuth completion', () => {
  it('completes the new provider login flow with a pasted code', async () => {
    mockReadFileSync.mockReturnValue('{}');
    mockWriteFileSync.mockReset();
    loadCredentials();
    mockOAuth.login.mockImplementationOnce(async (interaction) => {
      interaction.notify({ type: 'auth_url', url: 'https://auth.example.test' });
      const code = await interaction.prompt({ type: 'manual_code', message: 'Enter code' });
      expect(code).toBe('test-code');
      return {
        type: 'oauth',
        refresh: 'new-refresh',
        access: 'new-access',
        expires: Date.now() + 3600000,
      };
    });

    await expect(startOpenAICodexOAuth()).resolves.toBe('https://auth.example.test');
    await expect(completeOpenAICodexOAuth('test-code')).resolves.toBeUndefined();
    expect(hasOpenAICodexOAuth()).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
  });

  it('succeeds when the browser callback already stored ChatGPT credentials', async () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ 'openai-codex': { refresh: 'openai-refresh' } }),
    );
    loadCredentials();

    await expect(completeOpenAICodexOAuth('already-consumed-code')).resolves.toBeUndefined();
  });

  it('still rejects when there is no active flow or stored credential', async () => {
    mockReadFileSync.mockReturnValue('{}');
    loadCredentials();

    await expect(completeOpenAICodexOAuth('orphaned-code')).rejects.toThrow(
      'No OAuth flow in progress',
    );
  });
});
