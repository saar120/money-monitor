<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import {
  getSettings,
  updateSettings,
  toggleDemoMode,
  getAIProviders,
  type SettingsResponse,
  type AIProvider,
} from '../api/client';
import { useAnthropicOAuth } from '../composables/useAnthropicOAuth';
import { Card, CardContent } from '@/components/ui/card';
import { SettingsGroup, SettingsRow } from '@/components/ui/settings-group';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CheckCircle, AlertCircle, RefreshCw, Download } from 'lucide-vue-next';

const loading = ref(true);
const saving = ref(false);
const error = ref('');
const success = ref('');
const data = ref<SettingsResponse | null>(null);

const providers = ref<AIProvider[]>([]);
const useSeparateBatch = ref(false);

// Editable fields — populated from API, secrets left empty until user types
const form = ref({
  ANTHROPIC_API_KEY: '',
  ANTHROPIC_OAUTH_TOKEN: '',
  ANTHROPIC_MODEL: 'claude-sonnet-4-6',
  AI_PROVIDER: 'anthropic',
  AI_CHAT_MODEL: '',
  AI_BATCH_PROVIDER: '',
  AI_BATCH_MODEL_ID: '',
  OPENAI_API_KEY: '',
  GEMINI_API_KEY: '',
  OPENROUTER_API_KEY: '',
  CREDENTIALS_MASTER_KEY: '',
  SCRAPE_CRON: '0 6 * * *',
  SCRAPE_TIMEZONE: 'Asia/Jerusalem',
  SCRAPE_START_DATE_MONTHS_BACK: '3',
  SCRAPE_TIMEOUT: '120000',
  SCRAPE_SHOW_BROWSER: false,
  TELEGRAM_BOT_TOKEN: '',
  TELEGRAM_ALLOWED_USERS: '',
  AI_MAX_TURNS: '8',
});

const currentProvider = computed(() =>
  providers.value.find((p) => p.id === form.value.AI_PROVIDER),
);
const batchProvider = computed(() =>
  providers.value.find((p) => p.id === (form.value.AI_BATCH_PROVIDER || form.value.AI_PROVIDER)),
);
const currentApiKeyField = computed(
  () => (currentProvider.value?.apiKeyField ?? 'ANTHROPIC_API_KEY') as keyof typeof form.value,
);
const batchApiKeyField = computed(
  () => (batchProvider.value?.apiKeyField ?? 'ANTHROPIC_API_KEY') as keyof typeof form.value,
);

// Track which secret fields the user has modified
const dirtySecrets = ref<Set<string>>(new Set());

function markDirty(key: string) {
  dirtySecrets.value.add(key);
}

onMounted(async () => {
  try {
    const [settingsData, providersData] = await Promise.all([
      getSettings(),
      getAIProviders().catch(() => ({ providers: [] as AIProvider[] })),
    ]);

    data.value = settingsData;
    providers.value = providersData.providers;
    demoMode.value = data.value.demoMode ?? false;
    const s = data.value.settings;

    // Populate non-secret fields directly
    form.value.ANTHROPIC_MODEL = String(s.ANTHROPIC_MODEL || 'claude-sonnet-4-6');
    form.value.AI_PROVIDER = String(s.AI_PROVIDER || 'anthropic');
    form.value.AI_CHAT_MODEL = String(s.AI_CHAT_MODEL || '');
    form.value.AI_BATCH_PROVIDER = String(s.AI_BATCH_PROVIDER || '');
    form.value.AI_BATCH_MODEL_ID = String(s.AI_BATCH_MODEL_ID || '');
    useSeparateBatch.value = !!(s.AI_BATCH_PROVIDER || s.AI_BATCH_MODEL_ID);
    form.value.SCRAPE_CRON = String(s.SCRAPE_CRON || '0 6 * * *');
    form.value.SCRAPE_TIMEZONE = String(s.SCRAPE_TIMEZONE || 'Asia/Jerusalem');
    form.value.SCRAPE_START_DATE_MONTHS_BACK = String(s.SCRAPE_START_DATE_MONTHS_BACK || '3');
    form.value.SCRAPE_TIMEOUT = String(s.SCRAPE_TIMEOUT || '120000');
    form.value.SCRAPE_SHOW_BROWSER =
      s.SCRAPE_SHOW_BROWSER === true || s.SCRAPE_SHOW_BROWSER === 'true';
    form.value.TELEGRAM_ALLOWED_USERS = String(s.TELEGRAM_ALLOWED_USERS || '');
    form.value.AI_MAX_TURNS = String(s.AI_MAX_TURNS || '8');
    // Secret fields show redacted placeholder — left empty until user types
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load settings';
  } finally {
    loading.value = false;
  }

  // Auto-update listener
  if (electronAPI?.getAutoUpdateEnabled) {
    autoUpdateEnabled.value = await electronAPI.getAutoUpdateEnabled();
    cleanupUpdateListener = electronAPI.onUpdateStatus((data) => {
      updateStatus.value = data.status;
      if (data.version) updateVersion.value = data.version;
      if (data.percent != null) updatePercent.value = data.percent;
      if (data.error) updateError.value = data.error;
    });
  }
});

const isElectron = computed(() => data.value?.isElectron ?? false);

// ── Auto-update ─────────────────────────────────────────────────────────────
const electronAPI = (
  window as unknown as {
    electronAPI?: {
      getAutoUpdateEnabled: () => Promise<boolean>;
      setAutoUpdateEnabled: (enabled: boolean) => Promise<{ success: boolean }>;
      checkForUpdates: () => Promise<{ updateAvailable: boolean }>;
      installUpdate: () => void;
      onUpdateStatus: (
        cb: (data: { status: string; version?: string; percent?: number; error?: string }) => void,
      ) => () => void;
    };
  }
).electronAPI;
const autoUpdateEnabled = ref(true);
const updateStatus = ref<string>('idle');
const updateVersion = ref('');
const updatePercent = ref(0);
const updateError = ref('');
const checkingForUpdates = computed(() => updateStatus.value === 'checking');
let cleanupUpdateListener: (() => void) | null = null;

onUnmounted(() => {
  cleanupUpdateListener?.();
});

async function toggleAutoUpdate(enabled: boolean) {
  autoUpdateEnabled.value = enabled;
  await electronAPI?.setAutoUpdateEnabled(enabled);
}

async function manualCheckForUpdates() {
  updateStatus.value = 'checking';
  updateError.value = '';
  try {
    await electronAPI?.checkForUpdates();
  } catch {
    updateStatus.value = 'error';
  }
}

function installUpdate() {
  electronAPI?.installUpdate();
}

const updateStatusText = computed(() => {
  switch (updateStatus.value) {
    case 'checking':
      return 'Checking for updates...';
    case 'available':
      return `Update v${updateVersion.value} available`;
    case 'downloading':
      return `Downloading update... ${Math.round(updatePercent.value)}%`;
    case 'ready':
      return `v${updateVersion.value} ready to install`;
    case 'up-to-date':
      return 'App is up to date';
    case 'error':
      return `Update error: ${updateError.value}`;
    default:
      return '';
  }
});

const demoMode = ref(false);
const togglingDemo = ref(false);

async function handleDemoToggle(enabled: boolean) {
  togglingDemo.value = true;
  try {
    await toggleDemoMode(enabled);
    window.location.reload();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to toggle demo mode';
    togglingDemo.value = false;
  }
}

// ── Anthropic OAuth ──────────────────────────────────────────────────────────

const oauthConnected = computed(() => data.value?.oauth?.anthropic ?? false);
const { oauthStep, oauthCode, oauthError, startOAuth, submitOAuthCode, cancelOAuth } =
  useAnthropicOAuth({
    onSuccess: () => {
      if (data.value) data.value.oauth.anthropic = true;
    },
  });

// ── Save ─────────────────────────────────────────────────────────────────────

async function save() {
  saving.value = true;
  error.value = '';
  success.value = '';
  try {
    const updates: Record<string, string | number | boolean> = {
      ANTHROPIC_MODEL: form.value.ANTHROPIC_MODEL,
      AI_PROVIDER: form.value.AI_PROVIDER,
      AI_CHAT_MODEL: form.value.AI_CHAT_MODEL,
      AI_BATCH_PROVIDER: useSeparateBatch.value ? form.value.AI_BATCH_PROVIDER : '',
      AI_BATCH_MODEL_ID: useSeparateBatch.value ? form.value.AI_BATCH_MODEL_ID : '',
      SCRAPE_CRON: form.value.SCRAPE_CRON,
      SCRAPE_TIMEZONE: form.value.SCRAPE_TIMEZONE,
      SCRAPE_START_DATE_MONTHS_BACK: form.value.SCRAPE_START_DATE_MONTHS_BACK,
      SCRAPE_TIMEOUT: form.value.SCRAPE_TIMEOUT,
      SCRAPE_SHOW_BROWSER: form.value.SCRAPE_SHOW_BROWSER,
      TELEGRAM_ALLOWED_USERS: form.value.TELEGRAM_ALLOWED_USERS,
      AI_MAX_TURNS: form.value.AI_MAX_TURNS,
    };
    // Only include secrets that the user actually modified
    const secretKeys = [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_OAUTH_TOKEN',
      'CREDENTIALS_MASTER_KEY',
      'TELEGRAM_BOT_TOKEN',
      'OPENAI_API_KEY',
      'GEMINI_API_KEY',
      'OPENROUTER_API_KEY',
    ] as const;
    for (const key of secretKeys) {
      if (dirtySecrets.value.has(key) && form.value[key]) {
        updates[key] = form.value[key] as string;
      }
    }
    await updateSettings(updates);
    success.value = 'Settings saved. Some changes may require a restart.';
    dirtySecrets.value.clear();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to save settings';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto h-full overflow-y-auto pb-20 space-y-5 animate-fade-in-up">
    <div v-if="loading" class="text-text-secondary">Loading settings...</div>

    <template v-else-if="!isElectron">
      <Card>
        <CardContent class="pt-6">
          <p class="text-text-secondary">
            Settings are managed via the <code class="text-text-primary">.env</code> file in
            standalone mode. Edit <code class="text-text-primary">.env</code> and restart the server
            to apply changes.
          </p>
        </CardContent>
      </Card>
    </template>

    <template v-else>
      <Teleport to="#toolbar-actions">
        <div class="flex items-center gap-2">
          <div v-if="success" class="flex items-center gap-1.5 text-[13px] text-success">
            <CheckCircle class="h-3.5 w-3.5" />
            {{ success }}
          </div>
          <div v-if="error" class="flex items-center gap-1.5 text-[13px] text-destructive">
            <AlertCircle class="h-3.5 w-3.5" />
            {{ error }}
          </div>
          <Button size="sm" :disabled="saving" @click="save">
            {{ saving ? 'Saving…' : 'Save Settings' }}
          </Button>
        </div>
      </Teleport>

      <!-- AI Configuration -->
      <SettingsGroup title="AI Configuration" description="Choose your AI provider and model">
        <SettingsRow class="bg-bg-secondary/50">
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-secondary">
            <span
              >Provider:
              <strong class="text-text-primary">{{
                currentProvider?.name ?? form.AI_PROVIDER
              }}</strong></span
            >
            <span
              >Model:
              <strong class="text-text-primary">{{
                form.AI_CHAT_MODEL || form.ANTHROPIC_MODEL || 'default'
              }}</strong></span
            >
            <span v-if="form.AI_PROVIDER === 'anthropic'">
              Auth:
              <strong v-if="oauthConnected" class="text-text-primary">OAuth</strong>
              <strong v-else-if="data?.settings?.ANTHROPIC_OAUTH_TOKEN" class="text-text-primary"
                >Token</strong
              >
              <strong v-else-if="data?.settings?.ANTHROPIC_API_KEY" class="text-text-primary"
                >API Key</strong
              >
              <strong v-else class="text-destructive">Not set</strong>
            </span>
            <span v-else>
              Auth:
              <strong v-if="currentProvider?.hasKey" class="text-text-primary">API Key</strong>
              <strong v-else class="text-destructive">Not set</strong>
            </span>
          </div>
        </SettingsRow>

        <SettingsRow label="Provider">
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
        </SettingsRow>

        <SettingsRow :label="`${currentProvider?.name ?? 'API'} Key`">
          <Input
            type="password"
            class="w-52"
            :model-value="form[currentApiKeyField] as string"
            :placeholder="
              data?.settings?.[currentApiKeyField]
                ? String(data.settings[currentApiKeyField])
                : 'Not set'
            "
            @update:model-value="
              (v: string | number) => {
                (form[currentApiKeyField] as any) = String(v);
                markDirty(currentApiKeyField);
              }
            "
          />
        </SettingsRow>

        <!-- Anthropic OAuth section -->
        <template v-if="form.AI_PROVIDER === 'anthropic'">
          <SettingsRow vertical>
            <div class="relative flex items-center justify-center">
              <div class="absolute border-t w-full" />
              <span class="relative bg-bg-primary px-2 text-xs text-text-secondary">or</span>
            </div>

            <div
              v-if="oauthConnected && oauthStep === 'idle'"
              class="flex items-center gap-2 text-[13px]"
            >
              <CheckCircle class="h-4 w-4 text-green-500" />
              <span class="text-text-secondary">Anthropic OAuth connected</span>
            </div>

            <div v-else-if="oauthStep === 'idle'" class="space-y-1.5">
              <Button variant="secondary" size="sm" class="w-full" @click="startOAuth">
                Login with Anthropic
              </Button>
              <p class="text-[11px] text-text-secondary">
                Use your Anthropic account instead of an API key
              </p>
            </div>

            <div v-else-if="oauthStep === 'waiting_code'" class="space-y-2">
              <p class="text-[12px] text-text-secondary">
                A browser window has been opened. After authorizing, paste the code below:
              </p>
              <div class="flex gap-2">
                <Input
                  v-model="oauthCode"
                  placeholder="Paste authorization code..."
                  class="flex-1"
                  @keydown.enter="submitOAuthCode"
                />
                <Button size="sm" :disabled="!oauthCode.trim()" @click="submitOAuthCode">
                  Submit
                </Button>
              </div>
              <button class="text-[11px] text-text-secondary underline" @click="cancelOAuth">
                Cancel
              </button>
            </div>

            <div v-else-if="oauthStep === 'submitting'" class="text-[12px] text-text-secondary">
              Verifying authorization...
            </div>

            <p v-if="oauthError" class="text-[11px] text-destructive">{{ oauthError }}</p>

            <!-- Manual OAuth token paste -->
            <div class="space-y-1.5">
              <label class="text-[13px] font-medium text-text-primary block">OAuth Token</label>
              <Input
                v-model="form.ANTHROPIC_OAUTH_TOKEN"
                type="password"
                :placeholder="
                  data?.settings?.ANTHROPIC_OAUTH_TOKEN
                    ? String(data.settings.ANTHROPIC_OAUTH_TOKEN)
                    : 'Not set'
                "
                @input="markDirty('ANTHROPIC_OAUTH_TOKEN')"
              />
              <p class="text-[11px] text-text-secondary mt-1">
                Paste an OAuth token directly (e.g. from Claude Code CLI)
              </p>
            </div>
          </SettingsRow>
        </template>

        <SettingsRow label="Chat Model">
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
        </SettingsRow>

        <SettingsRow label="Separate Batch Model">
          <Switch v-model="useSeparateBatch" />
        </SettingsRow>

        <template v-if="useSeparateBatch">
          <SettingsRow label="Batch Provider">
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
          </SettingsRow>

          <SettingsRow
            v-if="form.AI_BATCH_PROVIDER && form.AI_BATCH_PROVIDER !== form.AI_PROVIDER"
            :label="`${batchProvider?.name ?? 'API'} Key`"
          >
            <Input
              type="password"
              class="w-52"
              :model-value="form[batchApiKeyField] as string"
              :placeholder="
                data?.settings?.[batchApiKeyField]
                  ? String(data.settings[batchApiKeyField])
                  : 'Not set'
              "
              @update:model-value="
                (v: string | number) => {
                  (form[batchApiKeyField] as any) = String(v);
                  markDirty(batchApiKeyField);
                }
              "
            />
          </SettingsRow>

          <SettingsRow label="Batch Model">
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
          </SettingsRow>
        </template>

        <SettingsRow label="Max Tool Rounds" description="API calls per chat message (1-20)">
          <Input v-model="form.AI_MAX_TURNS" type="number" min="1" max="20" class="w-20" />
        </SettingsRow>
      </SettingsGroup>

      <!-- Security -->
      <SettingsGroup title="Security" description="Encryption key for bank credentials">
        <SettingsRow
          label="Master Key"
          description="Changing this makes existing encrypted credentials unreadable"
        >
          <Input
            v-model="form.CREDENTIALS_MASTER_KEY"
            type="password"
            class="w-52"
            :placeholder="
              data?.settings.CREDENTIALS_MASTER_KEY
                ? String(data.settings.CREDENTIALS_MASTER_KEY)
                : 'Not set'
            "
            @input="markDirty('CREDENTIALS_MASTER_KEY')"
          />
        </SettingsRow>
      </SettingsGroup>

      <!-- Scraping -->
      <SettingsGroup title="Scraping" description="Bank scraping schedule and behavior">
        <SettingsRow label="Cron Schedule">
          <Input v-model="form.SCRAPE_CRON" placeholder="0 6 * * *" class="w-44" />
        </SettingsRow>
        <SettingsRow label="Timezone">
          <Input v-model="form.SCRAPE_TIMEZONE" placeholder="Asia/Jerusalem" class="w-44" />
        </SettingsRow>
        <SettingsRow label="Months Back">
          <Input v-model="form.SCRAPE_START_DATE_MONTHS_BACK" type="number" class="w-20" />
        </SettingsRow>
        <SettingsRow label="Timeout (ms)">
          <Input v-model="form.SCRAPE_TIMEOUT" type="number" class="w-28" />
        </SettingsRow>
        <SettingsRow label="Show browser during scrape">
          <Switch v-model="form.SCRAPE_SHOW_BROWSER" />
        </SettingsRow>
      </SettingsGroup>

      <!-- Telegram -->
      <SettingsGroup title="Telegram" description="Optional Telegram bot integration">
        <SettingsRow label="Bot Token">
          <Input
            v-model="form.TELEGRAM_BOT_TOKEN"
            type="password"
            class="w-52"
            :placeholder="
              data?.settings.TELEGRAM_BOT_TOKEN
                ? String(data.settings.TELEGRAM_BOT_TOKEN)
                : 'Not set'
            "
            @input="markDirty('TELEGRAM_BOT_TOKEN')"
          />
        </SettingsRow>
        <SettingsRow label="Allowed User IDs" description="Comma-separated">
          <Input
            v-model="form.TELEGRAM_ALLOWED_USERS"
            placeholder="Comma-separated user IDs"
            class="w-52"
          />
        </SettingsRow>
      </SettingsGroup>

      <!-- Updates -->
      <SettingsGroup title="Updates" description="Automatic update settings">
        <SettingsRow label="Auto-update" description="Automatically check for and download updates">
          <Switch :model-value="autoUpdateEnabled" @update:model-value="toggleAutoUpdate" />
        </SettingsRow>
        <SettingsRow label="Check for Updates">
          <div class="flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              :disabled="checkingForUpdates"
              @click="manualCheckForUpdates"
            >
              <RefreshCw
                class="h-3.5 w-3.5 mr-1.5"
                :class="{ 'animate-spin': checkingForUpdates }"
              />
              Check Now
            </Button>
            <Button v-if="updateStatus === 'ready'" size="sm" @click="installUpdate">
              <Download class="h-3.5 w-3.5 mr-1.5" />
              Install & Restart
            </Button>
          </div>
        </SettingsRow>
        <SettingsRow v-if="updateStatusText">
          <p
            class="text-[12px]"
            :class="{
              'text-text-secondary': ['checking', 'up-to-date', 'idle'].includes(updateStatus),
              'text-blue-500': ['available', 'downloading'].includes(updateStatus),
              'text-green-500': updateStatus === 'ready',
              'text-destructive': updateStatus === 'error',
            }"
          >
            {{ updateStatusText }}
          </p>
        </SettingsRow>
      </SettingsGroup>

      <!-- System Info (read-only) -->
      <SettingsGroup title="System" description="Read-only information">
        <SettingsRow label="Data Directory">
          <code class="text-[11px] text-text-primary bg-bg-secondary px-2 py-1 rounded">{{
            data?.dataDir
          }}</code>
        </SettingsRow>
      </SettingsGroup>
    </template>

    <!-- Demo mode toggle -->
    <div v-if="!loading" class="pt-4">
      <SettingsGroup>
        <SettingsRow label="Demo mode" description="View app with sample data">
          <Switch
            :model-value="demoMode"
            :disabled="togglingDemo"
            @update:model-value="handleDemoToggle"
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  </div>
</template>
