import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock pi-ai/oauth
const mockGetOAuthApiKey = vi.fn();
vi.mock('@mariozechner/pi-ai/oauth', () => ({
  getOAuthApiKey: mockGetOAuthApiKey,
  loginAnthropic: vi.fn(),
}));

// Mock paths
vi.mock('../paths.js', () => ({
  dataDir: '/tmp/test-auth',
}));

// Mock filesystem (prevent actual disk writes)
vi.mock('node:fs', () => ({
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Controllable config for testing
const mockConfig: Record<string, any> = {};

vi.mock('../config.js', () => ({
  get config() { return mockConfig; },
  isElectronMode: false,
  loadConfigFile: () => null,
  saveConfigFile: vi.fn(),
}));

// Import after all mocks are set up
const { resolveApiKey, PROVIDER_KEY_MAP, loadCredentials } = await import('./auth.js');

function resetConfig() {
  Object.assign(mockConfig, {
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_OAUTH_TOKEN: undefined,
    OPENAI_API_KEY: '',
    GEMINI_API_KEY: '',
    OPENROUTER_API_KEY: '',
  });
}

// ── PROVIDER_KEY_MAP ─────────────────────────────────────────────────────────

describe('PROVIDER_KEY_MAP', () => {
  it('maps all 4 supported providers to config fields', () => {
    expect(PROVIDER_KEY_MAP).toEqual({
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      google: 'GEMINI_API_KEY',
      openrouter: 'OPENROUTER_API_KEY',
    });
  });
});

// ── resolveApiKey ────────────────────────────────────────────────────────────

describe('resolveApiKey', () => {
  beforeEach(() => {
    resetConfig();
    mockGetOAuthApiKey.mockReset();
    loadCredentials(); // resets internal credentials to {}
  });

  it('returns OAuth API key when available (step 1)', async () => {
    mockGetOAuthApiKey.mockResolvedValue({
      apiKey: 'oauth-key-123',
      newCredentials: { refresh: 'tok' },
    });
    expect(await resolveApiKey('anthropic')).toBe('oauth-key-123');
  });

  it('falls through to ANTHROPIC_OAUTH_TOKEN for anthropic (step 2)', async () => {
    mockGetOAuthApiKey.mockResolvedValue(null);
    mockConfig.ANTHROPIC_OAUTH_TOKEN = 'oat-test-token';
    expect(await resolveApiKey('anthropic')).toBe('oat-test-token');
  });

  it('skips ANTHROPIC_OAUTH_TOKEN for non-anthropic providers', async () => {
    mockGetOAuthApiKey.mockResolvedValue(null);
    mockConfig.ANTHROPIC_OAUTH_TOKEN = 'oat-test-token';
    mockConfig.OPENAI_API_KEY = 'sk-openai';
    expect(await resolveApiKey('openai')).toBe('sk-openai');
  });

  it('returns config API key when OAuth fails (step 3)', async () => {
    mockGetOAuthApiKey.mockRejectedValue(new Error('OAuth expired'));
    mockConfig.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(await resolveApiKey('anthropic')).toBe('sk-ant-test');
  });

  it('returns config key for each provider', async () => {
    mockGetOAuthApiKey.mockResolvedValue(null);
    mockConfig.OPENAI_API_KEY = 'sk-openai';
    expect(await resolveApiKey('openai')).toBe('sk-openai');

    mockConfig.GEMINI_API_KEY = 'gem-key';
    expect(await resolveApiKey('google')).toBe('gem-key');

    mockConfig.OPENROUTER_API_KEY = 'or-key';
    expect(await resolveApiKey('openrouter')).toBe('or-key');
  });

  it('returns undefined when no key is available (step 4)', async () => {
    mockGetOAuthApiKey.mockResolvedValue(null);
    expect(await resolveApiKey('anthropic')).toBeUndefined();
  });

  it('returns undefined for unknown provider', async () => {
    mockGetOAuthApiKey.mockResolvedValue(null);
    expect(await resolveApiKey('unknown-provider')).toBeUndefined();
  });

  it('skips empty string config keys', async () => {
    mockGetOAuthApiKey.mockResolvedValue(null);
    mockConfig.ANTHROPIC_API_KEY = '';
    expect(await resolveApiKey('anthropic')).toBeUndefined();
  });
});
