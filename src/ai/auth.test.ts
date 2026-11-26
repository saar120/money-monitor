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
  renameSync: vi.fn(),
  rmSync: vi.fn(),
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: vi.fn(),
}));

// Controllable config for testing
const mockConfig: Record<string, any> = {
  CREDENTIALS_MASTER_KEY: 'synthetic-auth-master-key-at-least-32-characters',
};

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
  loadCredentials,
  completeOpenAICodexOAuth,
  startOpenAICodexOAuth,
  logoutOpenAICodexOAuth,
  hasAnthropicOAuth,
  hasOpenAICodexOAuth,
} = await import('./auth.js');

function resetConfig() {
  Object.assign(mockConfig, {
    CREDENTIALS_MASTER_KEY: 'synthetic-auth-master-key-at-least-32-characters',
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_OAUTH_TOKEN: undefined,
    OPENAI_API_KEY: '',
    OPENCODE_API_KEY: '',
    GEMINI_API_KEY: '',
    OPENROUTER_API_KEY: '',
  });
}

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

  it.each([
    ['missing key', 'anthropic', {}],
    ['unknown provider', 'unknown-provider', {}],
    ['empty string config key', 'anthropic', { ANTHROPIC_API_KEY: '' }],
  ])('returns undefined for %s (step 4)', async (_label, provider, overrides) => {
    Object.assign(mockConfig, overrides);
    expect(await resolveApiKey(provider)).toBeUndefined();
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

  it('migrates plaintext credentials, removes only ChatGPT credentials, and persists sealed output', () => {
    // Plaintext JSON loaded in beforeEach is immediately migrated to sealed:v1:
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/^\/tmp\/test-auth\/oauth-credentials\.json\..+\.tmp$/),
      expect.stringMatching(/^sealed:v1:/),
      { mode: 0o600, flag: 'wx' },
    );
    mockWriteFileSync.mockClear();

    expect(hasAnthropicOAuth()).toBe(true);
    expect(hasOpenAICodexOAuth()).toBe(true);

    logoutOpenAICodexOAuth();

    expect(hasOpenAICodexOAuth()).toBe(false);
    expect(hasAnthropicOAuth()).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/^\/tmp\/test-auth\/oauth-credentials\.json\..+\.tmp$/),
      expect.stringMatching(/^sealed:v1:/),
      { mode: 0o600, flag: 'wx' },
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
