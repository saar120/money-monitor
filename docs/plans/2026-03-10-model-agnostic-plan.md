# Model-Agnostic Provider Support — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users choose between Anthropic, OpenAI, Google Gemini, and OpenRouter via the Settings UI and Setup Wizard.

**Architecture:** Extend config with `AI_PROVIDER`, `AI_CHAT_MODEL`, per-provider API key fields. Add `/api/ai/providers` endpoint that returns models from pi-ai's registry. Redesign SettingsPage and SetupWizard with provider/model dropdowns.

**Tech Stack:** Zod (config), Fastify (API), Vue 3 + reka-ui Select components (UI), pi-ai `getModels()` (model registry)

---

### Task 1: Config Schema — New Fields

**Files:**
- Modify: `src/config.ts:33-51` (envSchema)
- Modify: `src/__tests__/setup.ts:3-19` (test mock)

**Step 1: Add new fields to envSchema**

In `src/config.ts`, add these fields to the `z.object({...})` at line 33, after `ANTHROPIC_MODEL` (line 41):

```ts
  AI_PROVIDER: z.string().default('anthropic'),
  AI_CHAT_MODEL: z.string().default(''),
  AI_BATCH_PROVIDER: z.string().default(''),
  AI_BATCH_MODEL_ID: z.string().default(''),
  OPENAI_API_KEY: z.string().default(''),
  GEMINI_API_KEY: z.string().default(''),
  OPENROUTER_API_KEY: z.string().default(''),
```

**Step 2: Update `getAIModelSpec()`**

Replace `src/config.ts:92-94`:

```ts
export function getAIModelSpec(): string {
  if (config.AI_MODEL) return config.AI_MODEL;
  const model = config.AI_CHAT_MODEL || config.ANTHROPIC_MODEL;
  return `${config.AI_PROVIDER}:${model}`;
}
```

This preserves backward compat: if `AI_CHAT_MODEL` is not set, falls back to `ANTHROPIC_MODEL`.

**Step 3: Update `getBatchModelSpec()`**

Replace `src/config.ts:97-99`:

```ts
export function getBatchModelSpec(): string {
  if (config.AI_BATCH_MODEL) return config.AI_BATCH_MODEL;
  const provider = config.AI_BATCH_PROVIDER || config.AI_PROVIDER;
  const model = config.AI_BATCH_MODEL_ID || config.AI_CHAT_MODEL || config.ANTHROPIC_MODEL;
  return `${provider}:${model}`;
}
```

**Step 4: Update test mock in `src/__tests__/setup.ts`**

Add the new config fields to the mock object at line 3:

```ts
    AI_PROVIDER: 'anthropic',
    AI_CHAT_MODEL: '',
    AI_BATCH_PROVIDER: '',
    AI_BATCH_MODEL_ID: '',
    OPENAI_API_KEY: '',
    GEMINI_API_KEY: '',
    OPENROUTER_API_KEY: '',
```

**Step 5: Run tests to verify nothing breaks**

Run: `npx vitest run`
Expected: All existing tests pass.

**Step 6: Commit**

```bash
git add src/config.ts src/__tests__/setup.ts
git commit -m "feat: add multi-provider config fields (AI_PROVIDER, AI_CHAT_MODEL, provider API keys)"
```

---

### Task 2: Auth Layer — Provider-Aware API Key Resolution

**Files:**
- Modify: `src/ai/auth.ts:44-64` (resolveApiKey)

**Step 1: Add PROVIDER_KEY_MAP and update resolveApiKey**

In `src/ai/auth.ts`, add the map before `resolveApiKey` and update the function. The full replacement for lines 40-67:

```ts
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
```

Add `Config` to the import from `../config.js` at line 6:

```ts
import { config } from '../config.js';
```

Change to:

```ts
import { config, type Config } from '../config.js';
```

**Step 2: Run tests**

Run: `npx vitest run`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add src/ai/auth.ts
git commit -m "feat: make resolveApiKey provider-aware with PROVIDER_KEY_MAP"
```

---

### Task 3: Update Agent Pre-Validation

**Files:**
- Modify: `src/ai/agent.ts:40-53` (hasEnvApiKey)

**Step 1: Replace `hasEnvApiKey` with import from auth**

Replace the `hasEnvApiKey` function in `src/ai/agent.ts` (lines 40-53) with one that uses the centralized `PROVIDER_KEY_MAP`:

```ts
import { resolveApiKey, loadCredentials, PROVIDER_KEY_MAP } from './auth.js';
```

Update the `hasEnvApiKey` function:

```ts
/** Check if the environment or config has an API key for the given provider. */
function hasEnvApiKey(provider: string): boolean {
  // Check config-based keys
  const configKey = PROVIDER_KEY_MAP[provider];
  if (configKey) {
    const val = config[configKey];
    if (typeof val === 'string' && val) return true;
  }
  // Check env vars that pi-ai looks for
  const envMap: Record<string, string[]> = {
    anthropic: ['ANTHROPIC_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'],
    openai: ['OPENAI_API_KEY'],
    google: ['GEMINI_API_KEY'],
    groq: ['GROQ_API_KEY'],
    xai: ['XAI_API_KEY'],
    openrouter: ['OPENROUTER_API_KEY'],
    mistral: ['MISTRAL_API_KEY'],
  };
  const vars = envMap[provider];
  return vars ? vars.some(v => !!process.env[v]) : false;
}
```

Also update the import line for auth.ts to include `PROVIDER_KEY_MAP`.

**Step 2: Run tests**

Run: `npx vitest run`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add src/ai/agent.ts
git commit -m "feat: use centralized PROVIDER_KEY_MAP in agent pre-validation"
```

---

### Task 4: Settings Routes — New Settable Keys + Provider Endpoint

**Files:**
- Modify: `src/api/settings.routes.ts:11-32` (SECRET_KEYS, SETTABLE_KEYS)
- Modify: `src/api/settings.routes.ts:57` (add new route)

**Step 1: Update SECRET_KEYS and SETTABLE_KEYS**

In `src/api/settings.routes.ts`, add to `SECRET_KEYS` (line 11):

```ts
const SECRET_KEYS = new Set([
  'CREDENTIALS_MASTER_KEY',
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'API_TOKEN',
  'TELEGRAM_BOT_TOKEN',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
]);
```

Update `SETTABLE_KEYS` (line 20):

```ts
const SETTABLE_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'AI_PROVIDER',
  'AI_CHAT_MODEL',
  'AI_BATCH_PROVIDER',
  'AI_BATCH_MODEL_ID',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'CREDENTIALS_MASTER_KEY',
  'SCRAPE_CRON',
  'SCRAPE_TIMEZONE',
  'SCRAPE_START_DATE_MONTHS_BACK',
  'SCRAPE_TIMEOUT',
  'SCRAPE_SHOW_BROWSER',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_ALLOWED_USERS',
] as const;
```

**Step 2: Add `/api/ai/providers` endpoint**

Add this import at the top of `src/api/settings.routes.ts`:

```ts
import { getModels } from '@mariozechner/pi-ai';
import type { KnownProvider } from '@mariozechner/pi-ai';
```

Inside the `settingsRoutes` function, add before the OAuth endpoints:

```ts
  // ── AI Provider registry ──────────────────────────────────────────────────

  const SUPPORTED_PROVIDERS = [
    { id: 'anthropic', name: 'Anthropic', authTypes: ['api_key', 'oauth'] as const, apiKeyField: 'ANTHROPIC_API_KEY' as const },
    { id: 'openai', name: 'OpenAI', authTypes: ['api_key'] as const, apiKeyField: 'OPENAI_API_KEY' as const },
    { id: 'google', name: 'Google Gemini', authTypes: ['api_key'] as const, apiKeyField: 'GEMINI_API_KEY' as const },
    { id: 'openrouter', name: 'OpenRouter', authTypes: ['api_key'] as const, apiKeyField: 'OPENROUTER_API_KEY' as const },
  ];

  app.get('/api/ai/providers', async (_request, reply) => {
    const providers = SUPPORTED_PROVIDERS.map(p => {
      const models = getModels(p.id as KnownProvider).map(m => ({
        id: m.id,
        name: m.name,
        reasoning: m.reasoning,
      }));
      const keyValue = config[p.apiKeyField];
      return {
        ...p,
        models,
        hasKey: typeof keyValue === 'string' && keyValue.length > 0,
      };
    });
    return reply.send({ providers });
  });
```

**Step 3: Add test for the new endpoint**

Add to `src/api/settings.routes.test.ts`:

```ts
  describe('GET /api/ai/providers', () => {
    it('returns supported providers with models', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/ai/providers',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.providers).toBeInstanceOf(Array);
      expect(body.providers.length).toBe(4);

      const anthropic = body.providers.find((p: any) => p.id === 'anthropic');
      expect(anthropic).toBeDefined();
      expect(anthropic.name).toBe('Anthropic');
      expect(anthropic.models.length).toBeGreaterThan(0);
      expect(anthropic.models[0]).toHaveProperty('id');
      expect(anthropic.models[0]).toHaveProperty('name');

      const openai = body.providers.find((p: any) => p.id === 'openai');
      expect(openai).toBeDefined();
      expect(openai.hasKey).toBe(false); // no key in test env
    });
  });
```

**Step 4: Run tests**

Run: `npx vitest run src/api/settings.routes.test.ts`
Expected: All tests pass including the new one.

**Step 5: Commit**

```bash
git add src/api/settings.routes.ts src/api/settings.routes.test.ts
git commit -m "feat: add /api/ai/providers endpoint and multi-provider settable keys"
```

---

### Task 5: API Client — Add `getAIProviders()`

**Files:**
- Modify: `dashboard/src/api/client.ts`

**Step 1: Add types and function**

Add after the `SettingsResponse` interface (around line 685):

```ts
export interface AIProviderModel {
  id: string;
  name: string;
  reasoning: boolean;
}

export interface AIProvider {
  id: string;
  name: string;
  models: AIProviderModel[];
  authTypes: string[];
  apiKeyField: string;
  hasKey: boolean;
}

export function getAIProviders() {
  return request<{ providers: AIProvider[] }>('/ai/providers');
}
```

**Step 2: Commit**

```bash
git add dashboard/src/api/client.ts
git commit -m "feat: add getAIProviders API client function"
```

---

### Task 6: SettingsPage.vue — Provider/Model Dropdowns

**Files:**
- Modify: `dashboard/src/components/SettingsPage.vue`

This is the largest UI change. The AI Configuration card gets redesigned.

**Step 1: Add imports**

Add to the imports section (after existing UI imports):

```ts
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getAIProviders, type AIProvider } from '@/api/client'
```

Add `ChevronDown` to the lucide imports if not already present.

**Step 2: Add provider state**

Add to the `<script setup>` block:

```ts
const providers = ref<AIProvider[]>([])
const selectedProvider = ref('anthropic')
const selectedBatchProvider = ref('')
const useSeparateBatch = ref(false)

onMounted(async () => {
  // ... existing settings load ...

  // Load AI providers
  try {
    const { providers: p } = await getAIProviders()
    providers.value = p
  } catch (e) {
    console.error('Failed to load AI providers:', e)
  }
})
```

Also update `form` ref to include the new fields:

```ts
const form = ref({
  // ... existing fields ...
  AI_PROVIDER: 'anthropic',
  AI_CHAT_MODEL: '',
  AI_BATCH_PROVIDER: '',
  AI_BATCH_MODEL_ID: '',
  OPENAI_API_KEY: '',
  GEMINI_API_KEY: '',
  OPENROUTER_API_KEY: '',
})
```

Add computed helpers:

```ts
const currentProvider = computed(() =>
  providers.value.find(p => p.id === form.value.AI_PROVIDER)
)
const batchProvider = computed(() =>
  providers.value.find(p => p.id === (form.value.AI_BATCH_PROVIDER || form.value.AI_PROVIDER))
)

/** Get the API key field name for the currently selected provider */
const currentApiKeyField = computed(() => currentProvider.value?.apiKeyField ?? 'ANTHROPIC_API_KEY')
const batchApiKeyField = computed(() => batchProvider.value?.apiKeyField ?? 'ANTHROPIC_API_KEY')
```

**Step 3: Replace the AI Configuration card template**

Replace the existing AI Configuration card (lines ~128-165) with:

```vue
<!-- AI Configuration -->
<Card>
  <CardHeader>
    <CardTitle class="flex items-center gap-2"><Bot class="w-5 h-5" /> AI Configuration</CardTitle>
    <CardDescription>Choose your AI provider and model</CardDescription>
  </CardHeader>
  <CardContent class="space-y-4">
    <!-- Provider -->
    <div class="space-y-1">
      <label class="text-sm font-medium">Provider</label>
      <Select v-model="form.AI_PROVIDER">
        <SelectTrigger>
          <SelectValue placeholder="Select provider" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="p in providers" :key="p.id" :value="p.id">
            {{ p.name }}
            <span v-if="p.hasKey" class="ml-1 text-green-500">&#10003;</span>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- API Key (dynamic per provider) -->
    <div class="space-y-1">
      <label class="text-sm font-medium">{{ currentProvider?.name ?? 'API' }} Key</label>
      <Input
        type="password"
        v-model="form[currentApiKeyField]"
        :placeholder="data?.settings?.[currentApiKeyField] ? String(data.settings[currentApiKeyField]) : 'Not set'"
        @input="markDirty(currentApiKeyField)"
      />
    </div>

    <!-- OAuth Token (Anthropic only) -->
    <div v-if="form.AI_PROVIDER === 'anthropic'" class="space-y-1">
      <label class="text-sm font-medium">Claude Code OAuth Token</label>
      <Input
        type="password"
        v-model="form.CLAUDE_CODE_OAUTH_TOKEN"
        :placeholder="data?.settings?.CLAUDE_CODE_OAUTH_TOKEN ? String(data.settings.CLAUDE_CODE_OAUTH_TOKEN) : 'Not set'"
        @input="markDirty('CLAUDE_CODE_OAUTH_TOKEN')"
      />
      <p class="text-xs text-muted-foreground">Alternative to API Key — from Claude Code CLI</p>
    </div>

    <!-- Chat Model -->
    <div class="space-y-1">
      <label class="text-sm font-medium">Chat Model</label>
      <Select v-model="form.AI_CHAT_MODEL">
        <SelectTrigger>
          <SelectValue placeholder="Select model" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="m in currentProvider?.models ?? []" :key="m.id" :value="m.id">
            {{ m.name }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- Batch Categorization -->
    <div class="border-t pt-4 space-y-3">
      <div class="flex items-center gap-2">
        <Switch v-model="useSeparateBatch" />
        <label class="text-sm font-medium">Use different model for batch categorization</label>
      </div>

      <template v-if="useSeparateBatch">
        <div class="space-y-1">
          <label class="text-sm font-medium">Batch Provider</label>
          <Select v-model="form.AI_BATCH_PROVIDER">
            <SelectTrigger>
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="p in providers" :key="p.id" :value="p.id">
                {{ p.name }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- Batch API Key (show if different from chat provider and no key configured) -->
        <div v-if="form.AI_BATCH_PROVIDER && form.AI_BATCH_PROVIDER !== form.AI_PROVIDER" class="space-y-1">
          <label class="text-sm font-medium">{{ batchProvider?.name ?? 'API' }} Key</label>
          <Input
            type="password"
            v-model="form[batchApiKeyField]"
            :placeholder="data?.settings?.[batchApiKeyField] ? String(data.settings[batchApiKeyField]) : 'Not set'"
            @input="markDirty(batchApiKeyField)"
          />
        </div>

        <div class="space-y-1">
          <label class="text-sm font-medium">Batch Model</label>
          <Select v-model="form.AI_BATCH_MODEL_ID">
            <SelectTrigger>
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="m in batchProvider?.models ?? []" :key="m.id" :value="m.id">
                {{ m.name }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </template>
    </div>
  </CardContent>
</Card>
```

**Step 4: Update the `save()` function**

The save function needs to include the new fields. Update it to always send `AI_PROVIDER` and `AI_CHAT_MODEL`, and conditionally send batch fields and all provider API keys that are dirty:

```ts
// Always include non-secret fields
updates.AI_PROVIDER = form.value.AI_PROVIDER
updates.AI_CHAT_MODEL = form.value.AI_CHAT_MODEL
if (useSeparateBatch.value) {
  updates.AI_BATCH_PROVIDER = form.value.AI_BATCH_PROVIDER
  updates.AI_BATCH_MODEL_ID = form.value.AI_BATCH_MODEL_ID
} else {
  updates.AI_BATCH_PROVIDER = ''
  updates.AI_BATCH_MODEL_ID = ''
}
```

Add the new API key fields to the dirty-secret handling loop. The existing pattern already iterates `SECRET_KEYS` — just ensure `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` are included in the list.

**Step 5: Update the `onMounted` settings load**

When loading settings, populate the new form fields from `data.settings`:

```ts
form.value.AI_PROVIDER = String(s.AI_PROVIDER || 'anthropic')
form.value.AI_CHAT_MODEL = String(s.AI_CHAT_MODEL || '')
form.value.AI_BATCH_PROVIDER = String(s.AI_BATCH_PROVIDER || '')
form.value.AI_BATCH_MODEL_ID = String(s.AI_BATCH_MODEL_ID || '')
useSeparateBatch.value = !!(s.AI_BATCH_PROVIDER || s.AI_BATCH_MODEL_ID)
```

**Step 6: Build and verify**

Run: `npm run build`
Expected: Build succeeds.

**Step 7: Commit**

```bash
git add dashboard/src/components/SettingsPage.vue
git commit -m "feat: redesign Settings AI card with provider/model dropdowns"
```

---

### Task 7: SetupWizard.vue — Provider Selection in Step 1

**Files:**
- Modify: `dashboard/src/components/SetupWizard.vue`

**Step 1: Add imports**

Add Select components and API client:

```ts
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getAIProviders, type AIProvider } from '@/api/client'
```

**Step 2: Add provider state**

Add to `<script setup>`:

```ts
const providers = ref<AIProvider[]>([])
const selectedProvider = ref('anthropic')
const selectedModel = ref('claude-sonnet-4-6')

onMounted(async () => {
  try {
    const { providers: p } = await getAIProviders()
    providers.value = p
  } catch (e) {
    console.error('Failed to load AI providers:', e)
  }
})

const currentProvider = computed(() =>
  providers.value.find(p => p.id === selectedProvider.value)
)
```

**Step 3: Redesign Step 1 template**

Replace the current Step 1 card content with:

```vue
<Card v-if="step === 1" class="w-full max-w-lg">
  <CardHeader>
    <CardTitle>AI Provider</CardTitle>
    <CardDescription>Choose your AI provider and enter your API key</CardDescription>
  </CardHeader>
  <CardContent class="space-y-4">
    <!-- Provider buttons -->
    <div class="grid grid-cols-2 gap-2">
      <Button
        v-for="p in providers"
        :key="p.id"
        :variant="selectedProvider === p.id ? 'default' : 'outline'"
        @click="selectedProvider = p.id; selectedModel = ''"
        class="justify-start"
      >
        {{ p.name }}
      </Button>
    </div>

    <!-- API Key -->
    <div class="space-y-1">
      <label class="text-sm font-medium">{{ currentProvider?.name ?? 'API' }} Key</label>
      <Input
        type="password"
        v-model="apiKey"
        :placeholder="selectedProvider === 'anthropic' ? 'sk-ant-...' : 'sk-...'"
      />
    </div>

    <!-- OAuth token (Anthropic only) -->
    <template v-if="selectedProvider === 'anthropic'">
      <div class="relative flex items-center justify-center">
        <div class="absolute border-t w-full" />
        <span class="relative bg-background px-2 text-xs text-muted-foreground">or</span>
      </div>
      <div class="space-y-1">
        <label class="text-sm font-medium">OAuth Token</label>
        <Input type="password" v-model="oauthToken" placeholder="oat-..." />
      </div>
    </template>

    <!-- Model selection -->
    <div class="space-y-1">
      <label class="text-sm font-medium">Model</label>
      <Select v-model="selectedModel">
        <SelectTrigger>
          <SelectValue placeholder="Select model" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="m in currentProvider?.models ?? []" :key="m.id" :value="m.id">
            {{ m.name }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  </CardContent>
  <!-- ... navigation buttons ... -->
</Card>
```

**Step 4: Update the `finish()` function**

Update the settings object built in `finish()` to include the new fields:

```ts
const settings: Record<string, string> = {}
settings.AI_PROVIDER = selectedProvider.value
if (selectedModel.value) {
  settings.AI_CHAT_MODEL = selectedModel.value
}

// Provider-specific API key
const provider = currentProvider.value
if (provider && apiKey.value) {
  settings[provider.apiKeyField] = apiKey.value
}
if (selectedProvider.value === 'anthropic' && oauthToken.value) {
  settings.CLAUDE_CODE_OAUTH_TOKEN = oauthToken.value
}

// Keep existing fields
settings.CREDENTIALS_MASTER_KEY = masterKey.value
// ... rest of existing finish() logic
```

**Step 5: Update `canProceed` computed**

```ts
const canProceed = computed(() => {
  if (step.value === 1) {
    return !!(apiKey.value || oauthToken.value)
  }
  // ... rest unchanged
})
```

Note: `oauthToken` should only be considered when provider is anthropic. Rename existing `anthropicApiKey` → `apiKey` and `claudeOauthToken` → `oauthToken` (or introduce new refs).

**Step 6: Build and verify**

Run: `npm run build`
Expected: Build succeeds.

**Step 7: Commit**

```bash
git add dashboard/src/components/SetupWizard.vue
git commit -m "feat: redesign Setup Wizard Step 1 with multi-provider selection"
```

---

### Task 8: Integration Verification

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

**Step 2: Build**

Run: `npm run build`
Expected: Clean build with no errors.

**Step 3: Manual smoke test (if possible)**

1. Start the app
2. Open Settings — verify provider dropdown shows 4 providers
3. Switch provider — verify model dropdown updates
4. Enter API key — verify save works
5. Open Setup Wizard — verify provider cards and model dropdown work
6. Configure batch model separately — verify toggle and dropdowns work

**Step 4: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix: integration fixups for multi-provider support"
```
