# Model-Agnostic AI Provider Support

**Date:** 2026-03-10
**Status:** Approved

## Goal

Make the project provider-agnostic: users can connect Anthropic (current), OpenAI, Google Gemini, or OpenRouter via the Settings UI and Setup Wizard. The pi-ai library already supports 20+ providers; this design exposes first-class UI for the top 4.

## Supported Providers

| Provider | ID | API Key Env Var | Auth Methods |
|---|---|---|---|
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` | API key, OAuth token, OAuth device flow |
| OpenAI | `openai` | `OPENAI_API_KEY` | API key |
| Google Gemini | `google` | `GEMINI_API_KEY` | API key |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | API key |

Additional providers remain usable via `AI_MODEL` env var override.

## Config Schema (`src/config.ts`)

### New Fields

| Field | Type | Default | Purpose |
|---|---|---|---|
| `AI_PROVIDER` | `string` | `'anthropic'` | Active chat provider ID |
| `AI_CHAT_MODEL` | `string` | `'claude-sonnet-4-6'` | Model ID within chat provider |
| `AI_BATCH_PROVIDER` | `string?` | — | Batch provider (falls back to `AI_PROVIDER`) |
| `AI_BATCH_MODEL_ID` | `string?` | — | Batch model (falls back to `AI_CHAT_MODEL`) |
| `OPENAI_API_KEY` | `string` | `''` | OpenAI API key |
| `GEMINI_API_KEY` | `string` | `''` | Google Gemini API key |
| `OPENROUTER_API_KEY` | `string` | `''` | OpenRouter API key |

### Kept As-Is

- `AI_MODEL` — full `"provider:model"` override (power-user env var, takes priority)
- `AI_BATCH_MODEL` — full `"provider:model"` override for batch
- `ANTHROPIC_API_KEY` — unchanged
- `CLAUDE_CODE_OAUTH_TOKEN` — unchanged

### Deprecated (Backward Compat)

- `ANTHROPIC_MODEL` — still read if `AI_PROVIDER` + `AI_CHAT_MODEL` not set

### Resolution Chain

```
getAIModelSpec():
  1. config.AI_MODEL (full "provider:model" override)
  2. config.AI_PROVIDER + ':' + config.AI_CHAT_MODEL
  3. 'anthropic:' + config.ANTHROPIC_MODEL (legacy fallback)

getBatchModelSpec():
  1. config.AI_BATCH_MODEL (full "provider:model" override)
  2. config.AI_BATCH_PROVIDER + ':' + config.AI_BATCH_MODEL_ID
  3. getAIModelSpec() (same as chat)
```

## Backend API

### New Endpoint: `GET /api/ai/providers`

Returns supported providers with their models from pi-ai's registry:

```json
{
  "providers": [
    {
      "id": "anthropic",
      "name": "Anthropic",
      "models": [
        { "id": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6" },
        { "id": "claude-opus-4-6", "name": "Claude Opus 4.6" }
      ],
      "authTypes": ["api_key", "oauth"],
      "apiKeyEnvVar": "ANTHROPIC_API_KEY",
      "hasKey": true
    }
  ]
}
```

Uses pi-ai's `getProviders()` and `getModels(provider)`, filtered to the 4 supported providers.

### Auth Layer (`src/ai/auth.ts`)

`resolveApiKey(provider)` resolution order:

1. OAuth credentials (existing, works for any provider pi-ai supports)
2. `CLAUDE_CODE_OAUTH_TOKEN` (anthropic only)
3. Provider-specific config key via `PROVIDER_KEY_MAP`:
   ```ts
   const PROVIDER_KEY_MAP = {
     anthropic: 'ANTHROPIC_API_KEY',
     openai: 'OPENAI_API_KEY',
     google: 'GEMINI_API_KEY',
     openrouter: 'OPENROUTER_API_KEY',
   };
   ```
4. Return `undefined` (lets pi-ai check env vars as final fallback)

### Settings Routes (`src/api/settings.routes.ts`)

Add to `SETTABLE_KEYS`:
- `AI_PROVIDER`, `AI_CHAT_MODEL`, `AI_BATCH_PROVIDER`, `AI_BATCH_MODEL_ID`
- `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`

Add to `SECRET_KEYS`:
- `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`

## Settings UI (`SettingsPage.vue`)

Redesigned AI Configuration card:

```
+-- AI Configuration ----------------------------+
| Provider:    [Anthropic      v]                |
| API Key:     [................]                |
| OAuth Token: [................] (Anthropic only)|
| Chat Model:  [Claude Sonnet 4.6  v]           |
|                                                 |
| > Batch Categorization Model                   |
|   [ ] Use different model for batch            |
|   Provider: [Google Gemini   v]                |
|   API Key:  [................]                 |
|   Model:    [Gemini 2.5 Flash v]              |
+-------------------------------------------------+
```

Key behaviors:
- Provider dropdown shows green checkmark for providers with configured keys
- API key input label changes dynamically per provider
- OAuth token field only visible when provider is Anthropic
- Model dropdown populated from `/api/ai/providers` endpoint
- Batch section is collapsible, defaults to "same as chat"
- Switching providers doesn't lose previously entered keys

## Setup Wizard (`SetupWizard.vue`)

Step 1 redesigned:

```
+-- Step 1: AI Provider -------------------------+
|                                                 |
|  Choose your AI provider:                       |
|                                                 |
|  [Anthropic] [OpenAI] [Gemini] [OpenRouter]    |
|      ^                                          |
|                                                 |
|  Anthropic API Key:                             |
|  [sk-ant-...                                  ] |
|  -- or --                                       |
|  OAuth Token:                                   |
|  [oat-...                                     ] |
|                                                 |
|  Model:                                         |
|  [Claude Sonnet 4.6              v]            |
|                                                 |
|              [Skip]          [Next ->]          |
+-------------------------------------------------+
```

Steps 2 (Encryption Key) and 3 (Optional Settings) unchanged.

## Migration / Backward Compatibility

- Existing `ANTHROPIC_MODEL` config continues to work via legacy fallback
- Existing `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` work unchanged
- `AI_MODEL` env var override still takes priority for power users
- First load after upgrade: `AI_PROVIDER` defaults to `'anthropic'`, `AI_CHAT_MODEL` defaults to `'claude-sonnet-4-6'` — same behavior as before
- Old credentials on disk (from OAuth flow) continue to work

## Key Files to Modify

| File | Changes |
|---|---|
| `src/config.ts` | New fields, updated resolution functions |
| `src/ai/auth.ts` | Provider-aware `resolveApiKey`, `PROVIDER_KEY_MAP` |
| `src/ai/agent.ts` | Update `hasEnvApiKey` to use `PROVIDER_KEY_MAP`, update pre-validation |
| `src/api/settings.routes.ts` | New settable/secret keys, new `/api/ai/providers` endpoint |
| `dashboard/src/components/SettingsPage.vue` | Provider dropdown, dynamic API key fields, model dropdowns, batch config |
| `dashboard/src/components/SetupWizard.vue` | Provider selection cards, dynamic auth fields, model dropdown |
| `dashboard/src/api/client.ts` | New `getAIProviders()` API function |
