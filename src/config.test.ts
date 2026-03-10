import { describe, it, expect, beforeEach } from 'vitest';

// Ensure required env var is set before importing the real module
process.env.CREDENTIALS_MASTER_KEY = process.env.CREDENTIALS_MASTER_KEY || 'test-config-functions-key';

// Import actual implementations (bypassing the global mock from setup.ts)
// config.ts has top-level await but works fine in vitest's ESM environment.
const { parseModelSpec, getAIModelSpec, getBatchModelSpec, config } =
  await vi.importActual<typeof import('./config.js')>('./config.js');

// ── parseModelSpec ───────────────────────────────────────────────────────────

describe('parseModelSpec', () => {
  it('splits provider:model on first colon', () => {
    expect(parseModelSpec('openai:gpt-4o')).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });

  it('defaults to anthropic when no colon', () => {
    expect(parseModelSpec('claude-sonnet-4-6')).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
  });

  it('handles multiple colons (only splits on first)', () => {
    expect(parseModelSpec('openrouter:openai/gpt-4o')).toEqual({
      provider: 'openrouter',
      model: 'openai/gpt-4o',
    });
  });
});

// ── getAIModelSpec ───────────────────────────────────────────────────────────

describe('getAIModelSpec', () => {
  beforeEach(() => {
    // Reset to defaults
    config.AI_MODEL = undefined;
    config.AI_PROVIDER = 'anthropic';
    config.AI_CHAT_MODEL = '';
    config.ANTHROPIC_MODEL = 'claude-sonnet-4-6';
  });

  it('returns AI_MODEL verbatim when set (legacy override)', () => {
    config.AI_MODEL = 'openai:gpt-4o';
    expect(getAIModelSpec()).toBe('openai:gpt-4o');
  });

  it('uses AI_PROVIDER:AI_CHAT_MODEL when AI_MODEL is not set', () => {
    config.AI_PROVIDER = 'openai';
    config.AI_CHAT_MODEL = 'gpt-4o';
    expect(getAIModelSpec()).toBe('openai:gpt-4o');
  });

  it('falls back to ANTHROPIC_MODEL when AI_CHAT_MODEL is empty', () => {
    config.AI_PROVIDER = 'anthropic';
    config.AI_CHAT_MODEL = '';
    expect(getAIModelSpec()).toBe('anthropic:claude-sonnet-4-6');
  });

  it('combines non-anthropic provider with ANTHROPIC_MODEL fallback', () => {
    config.AI_PROVIDER = 'google';
    config.AI_CHAT_MODEL = '';
    config.ANTHROPIC_MODEL = 'claude-sonnet-4-6';
    expect(getAIModelSpec()).toBe('google:claude-sonnet-4-6');
  });
});

// ── getBatchModelSpec ────────────────────────────────────────────────────────

describe('getBatchModelSpec', () => {
  beforeEach(() => {
    config.AI_BATCH_MODEL = undefined;
    config.AI_BATCH_PROVIDER = '';
    config.AI_BATCH_MODEL_ID = '';
    config.AI_MODEL = undefined;
    config.AI_PROVIDER = 'anthropic';
    config.AI_CHAT_MODEL = '';
    config.ANTHROPIC_MODEL = 'claude-sonnet-4-6';
  });

  it('returns AI_BATCH_MODEL verbatim when set (legacy override)', () => {
    config.AI_BATCH_MODEL = 'openai:gpt-4o-mini';
    expect(getBatchModelSpec()).toBe('openai:gpt-4o-mini');
  });

  it('uses AI_BATCH_PROVIDER and AI_BATCH_MODEL_ID when set', () => {
    config.AI_BATCH_PROVIDER = 'openai';
    config.AI_BATCH_MODEL_ID = 'gpt-4o-mini';
    expect(getBatchModelSpec()).toBe('openai:gpt-4o-mini');
  });

  it('falls back to AI_PROVIDER when AI_BATCH_PROVIDER is empty', () => {
    config.AI_PROVIDER = 'google';
    config.AI_BATCH_MODEL_ID = 'gemini-flash';
    expect(getBatchModelSpec()).toBe('google:gemini-flash');
  });

  it('falls back to AI_CHAT_MODEL when AI_BATCH_MODEL_ID is empty', () => {
    config.AI_PROVIDER = 'openai';
    config.AI_CHAT_MODEL = 'gpt-4o';
    expect(getBatchModelSpec()).toBe('openai:gpt-4o');
  });

  it('falls through to ANTHROPIC_MODEL as final model fallback', () => {
    config.AI_PROVIDER = 'anthropic';
    expect(getBatchModelSpec()).toBe('anthropic:claude-sonnet-4-6');
  });

  it('batch provider overrides chat provider independently', () => {
    config.AI_PROVIDER = 'anthropic';
    config.AI_CHAT_MODEL = 'claude-haiku-3';
    config.AI_BATCH_PROVIDER = 'openai';
    config.AI_BATCH_MODEL_ID = 'gpt-4o-mini';
    expect(getBatchModelSpec()).toBe('openai:gpt-4o-mini');
  });
});
