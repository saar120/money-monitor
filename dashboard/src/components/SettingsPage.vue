<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { getSettings, updateSettings, toggleDemoMode, getAIProviders, getBackups, createBackup, deleteBackup, restoreBackup, getBackupDownloadUrl, type SettingsResponse, type AIProvider, type BackupEntry } from '../api/client';
import { useAnthropicOAuth } from '../composables/useAnthropicOAuth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings, Bot, Key, Clock, Send, FolderOpen, Save, CheckCircle, AlertCircle, Archive, Download, Trash2, RotateCcw } from 'lucide-vue-next';

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
  providers.value.find(p => p.id === form.value.AI_PROVIDER)
);
const batchProvider = computed(() =>
  providers.value.find(p => p.id === (form.value.AI_BATCH_PROVIDER || form.value.AI_PROVIDER))
);
const currentApiKeyField = computed(() =>
  (currentProvider.value?.apiKeyField ?? 'ANTHROPIC_API_KEY') as keyof typeof form.value
);
const batchApiKeyField = computed(() =>
  (batchProvider.value?.apiKeyField ?? 'ANTHROPIC_API_KEY') as keyof typeof form.value
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
    form.value.SCRAPE_SHOW_BROWSER = s.SCRAPE_SHOW_BROWSER === true || s.SCRAPE_SHOW_BROWSER === 'true';
    form.value.TELEGRAM_ALLOWED_USERS = String(s.TELEGRAM_ALLOWED_USERS || '');
    form.value.AI_MAX_TURNS = String(s.AI_MAX_TURNS || '8');
    // Secret fields show redacted placeholder — left empty until user types
    loadBackups();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load settings';
  } finally {
    loading.value = false;
  }
});

const isElectron = computed(() => data.value?.isElectron ?? false);
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
const { oauthStep, oauthCode, oauthError, startOAuth, submitOAuthCode, cancelOAuth } = useAnthropicOAuth({
  onSuccess: () => { if (data.value) data.value.oauth.anthropic = true; },
});

// ── Backup & Restore ──────────────────────────────────────────────────────────

const backups = ref<BackupEntry[]>([]);
const backupsLoading = ref(false);
const backupCreating = ref(false);
const backupRestoring = ref<string | null>(null);
const backupError = ref('');
const backupSuccess = ref('');
const confirmRestore = ref<string | null>(null);

async function loadBackups() {
  backupsLoading.value = true;
  try {
    const result = await getBackups();
    backups.value = result.backups;
  } catch (e) {
    backupError.value = e instanceof Error ? e.message : 'Failed to load backups';
  } finally {
    backupsLoading.value = false;
  }
}

async function handleCreateBackup() {
  backupCreating.value = true;
  backupError.value = '';
  backupSuccess.value = '';
  try {
    const result = await createBackup();
    backupSuccess.value = `Backup created: ${result.backup.filename}`;
    await loadBackups();
  } catch (e) {
    backupError.value = e instanceof Error ? e.message : 'Backup failed';
  } finally {
    backupCreating.value = false;
  }
}

async function handleDeleteBackup(filename: string) {
  backupError.value = '';
  backupSuccess.value = '';
  try {
    await deleteBackup(filename);
    backups.value = backups.value.filter(b => b.filename !== filename);
  } catch (e) {
    backupError.value = e instanceof Error ? e.message : 'Delete failed';
  }
}

function handleDownloadBackup(filename: string) {
  const url = getBackupDownloadUrl(filename);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

async function handleRestore(filename: string) {
  if (confirmRestore.value !== filename) {
    confirmRestore.value = filename;
    return;
  }
  confirmRestore.value = null;
  backupRestoring.value = filename;
  backupError.value = '';
  backupSuccess.value = '';
  try {
    const result = await restoreBackup(filename);
    backupSuccess.value = result.message;
  } catch (e) {
    backupError.value = e instanceof Error ? e.message : 'Restore failed';
  } finally {
    backupRestoring.value = null;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatBackupDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

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
      'ANTHROPIC_API_KEY', 'ANTHROPIC_OAUTH_TOKEN', 'CREDENTIALS_MASTER_KEY',
      'TELEGRAM_BOT_TOKEN', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY',
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
  <div class="max-w-2xl mx-auto h-full overflow-y-auto space-y-6 animate-fade-in-up">
    <div class="flex items-center gap-3">
      <Settings class="h-6 w-6 text-primary" />
      <h1 class="text-[22px] font-semibold text-text-primary">Settings</h1>
    </div>

    <div v-if="loading" class="text-text-secondary">Loading settings...</div>

    <template v-else-if="!isElectron">
      <Card>
        <CardContent class="pt-6">
          <p class="text-text-secondary">
            Settings are managed via the <code class="text-text-primary">.env</code> file in standalone mode.
            Edit <code class="text-text-primary">.env</code> and restart the server to apply changes.
          </p>
        </CardContent>
      </Card>
    </template>

    <template v-else>
      <!-- AI Configuration -->
      <Card>
        <CardHeader>
          <div class="flex items-center gap-3">
            <Bot class="h-5 w-5 text-primary" />
            <div>
              <CardTitle class="text-[15px]">AI Configuration</CardTitle>
              <CardDescription>Choose your AI provider and model</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent class="space-y-4">
          <!-- Current status -->
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-secondary bg-bg-secondary rounded-md px-3 py-2">
            <span>Provider: <strong class="text-text-primary">{{ currentProvider?.name ?? form.AI_PROVIDER }}</strong></span>
            <span>Model: <strong class="text-text-primary">{{ form.AI_CHAT_MODEL || form.ANTHROPIC_MODEL || 'default' }}</strong></span>
            <span v-if="form.AI_PROVIDER === 'anthropic'">
              Auth:
              <strong class="text-text-primary" v-if="oauthConnected">OAuth</strong>
              <strong class="text-text-primary" v-else-if="data?.settings?.ANTHROPIC_OAUTH_TOKEN">Token</strong>
              <strong class="text-text-primary" v-else-if="data?.settings?.ANTHROPIC_API_KEY">API Key</strong>
              <strong class="text-destructive" v-else>Not set</strong>
            </span>
            <span v-else>
              Auth:
              <strong class="text-text-primary" v-if="currentProvider?.hasKey">API Key</strong>
              <strong class="text-destructive" v-else>Not set</strong>
            </span>
          </div>

          <!-- Provider -->
          <div class="space-y-1">
            <label class="text-[13px] font-medium text-text-primary block">Provider</label>
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
            <label class="text-[13px] font-medium text-text-primary block">{{ currentProvider?.name ?? 'API' }} Key</label>
            <Input
              type="password"
              :model-value="form[currentApiKeyField] as string"
              @update:model-value="(v: string | number) => { (form[currentApiKeyField] as any) = String(v); markDirty(currentApiKeyField) }"
              :placeholder="data?.settings?.[currentApiKeyField] ? String(data.settings[currentApiKeyField]) : 'Not set'"
            />
          </div>

          <!-- Anthropic OAuth (alternative to API key) -->
          <template v-if="form.AI_PROVIDER === 'anthropic'">
            <div class="relative flex items-center justify-center">
              <div class="absolute border-t w-full" />
              <span class="relative bg-card px-2 text-xs text-muted-foreground">or</span>
            </div>

            <div v-if="oauthConnected && oauthStep === 'idle'" class="flex items-center gap-2 text-[13px]">
              <CheckCircle class="h-4 w-4 text-green-500" />
              <span class="text-text-secondary">Anthropic OAuth connected</span>
            </div>

            <div v-else-if="oauthStep === 'idle'" class="space-y-1.5">
              <Button variant="outline" size="sm" @click="startOAuth" class="w-full">
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
              <button class="text-[11px] text-text-secondary underline" @click="cancelOAuth">Cancel</button>
            </div>

            <div v-else-if="oauthStep === 'submitting'" class="text-[12px] text-text-secondary">
              Verifying authorization...
            </div>

            <p v-if="oauthError" class="text-[11px] text-destructive">{{ oauthError }}</p>

            <!-- Manual OAuth token paste -->
            <div class="space-y-1">
              <label class="text-[13px] font-medium text-text-primary block">OAuth Token</label>
              <Input
                type="password"
                v-model="form.ANTHROPIC_OAUTH_TOKEN"
                :placeholder="data?.settings?.ANTHROPIC_OAUTH_TOKEN ? String(data.settings.ANTHROPIC_OAUTH_TOKEN) : 'Not set'"
                @input="markDirty('ANTHROPIC_OAUTH_TOKEN')"
              />
              <p class="text-[11px] text-text-secondary mt-1">Paste an OAuth token directly (e.g. from Claude Code CLI)</p>
            </div>
          </template>

          <!-- Chat Model -->
          <div class="space-y-1">
            <label class="text-[13px] font-medium text-text-primary block">Chat Model</label>
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
              <label class="text-[13px] text-text-primary">Use different model for batch categorization</label>
            </div>

            <template v-if="useSeparateBatch">
              <div class="space-y-1">
                <label class="text-[13px] font-medium text-text-primary block">Batch Provider</label>
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

              <!-- Batch API Key (show if different from chat provider) -->
              <div v-if="form.AI_BATCH_PROVIDER && form.AI_BATCH_PROVIDER !== form.AI_PROVIDER" class="space-y-1">
                <label class="text-[13px] font-medium text-text-primary block">{{ batchProvider?.name ?? 'API' }} Key</label>
                <Input
                  type="password"
                  :model-value="form[batchApiKeyField] as string"
                  @update:model-value="(v: string | number) => { (form[batchApiKeyField] as any) = String(v); markDirty(batchApiKeyField) }"
                  :placeholder="data?.settings?.[batchApiKeyField] ? String(data.settings[batchApiKeyField]) : 'Not set'"
                />
              </div>

              <div class="space-y-1">
                <label class="text-[13px] font-medium text-text-primary block">Batch Model</label>
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

          <!-- Max Turns -->
          <div class="border-t pt-4 space-y-1">
            <label class="text-[13px] font-medium text-text-primary block">Max Tool Rounds</label>
            <Input v-model="form.AI_MAX_TURNS" type="number" min="1" max="20" />
            <p class="text-[11px] text-text-secondary mt-1">
              Maximum API calls per chat message (each tool use is one round). Lower values reduce rate-limit issues but may limit complex answers.
            </p>
          </div>
        </CardContent>
      </Card>

      <!-- Security -->
      <Card>
        <CardHeader>
          <div class="flex items-center gap-3">
            <Key class="h-5 w-5 text-primary" />
            <div>
              <CardTitle class="text-[15px]">Security</CardTitle>
              <CardDescription>Encryption key for bank credentials</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div>
            <label class="text-[13px] font-medium text-text-primary block mb-1.5">Master Key</label>
            <Input
              v-model="form.CREDENTIALS_MASTER_KEY"
              type="password"
              :placeholder="data?.settings.CREDENTIALS_MASTER_KEY ? String(data.settings.CREDENTIALS_MASTER_KEY) : 'Not set'"
              @input="markDirty('CREDENTIALS_MASTER_KEY')"
            />
            <p class="text-[11px] text-text-secondary mt-1.5">
              Changing this will make existing encrypted credentials unreadable.
            </p>
          </div>
        </CardContent>
      </Card>

      <!-- Scraping -->
      <Card>
        <CardHeader>
          <div class="flex items-center gap-3">
            <Clock class="h-5 w-5 text-primary" />
            <div>
              <CardTitle class="text-[15px]">Scraping</CardTitle>
              <CardDescription>Bank scraping schedule and behavior</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="text-[13px] font-medium text-text-primary block mb-1.5">Cron Schedule</label>
              <Input v-model="form.SCRAPE_CRON" placeholder="0 6 * * *" />
            </div>
            <div>
              <label class="text-[13px] font-medium text-text-primary block mb-1.5">Timezone</label>
              <Input v-model="form.SCRAPE_TIMEZONE" placeholder="Asia/Jerusalem" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="text-[13px] font-medium text-text-primary block mb-1.5">Months Back</label>
              <Input v-model="form.SCRAPE_START_DATE_MONTHS_BACK" type="number" />
            </div>
            <div>
              <label class="text-[13px] font-medium text-text-primary block mb-1.5">Timeout (ms)</label>
              <Input v-model="form.SCRAPE_TIMEOUT" type="number" />
            </div>
          </div>
          <div class="flex items-center gap-3">
            <Switch v-model="form.SCRAPE_SHOW_BROWSER" />
            <label class="text-[13px] text-text-primary">Show browser window during scrape</label>
          </div>
        </CardContent>
      </Card>

      <!-- Telegram -->
      <Card>
        <CardHeader>
          <div class="flex items-center gap-3">
            <Send class="h-5 w-5 text-primary" />
            <div>
              <CardTitle class="text-[15px]">Telegram</CardTitle>
              <CardDescription>Optional Telegram bot integration</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent class="space-y-4">
          <div>
            <label class="text-[13px] font-medium text-text-primary block mb-1.5">Bot Token</label>
            <Input
              v-model="form.TELEGRAM_BOT_TOKEN"
              type="password"
              :placeholder="data?.settings.TELEGRAM_BOT_TOKEN ? String(data.settings.TELEGRAM_BOT_TOKEN) : 'Not set'"
              @input="markDirty('TELEGRAM_BOT_TOKEN')"
            />
          </div>
          <div>
            <label class="text-[13px] font-medium text-text-primary block mb-1.5">Allowed User IDs</label>
            <Input v-model="form.TELEGRAM_ALLOWED_USERS" placeholder="Comma-separated user IDs" />
          </div>
        </CardContent>
      </Card>

      <!-- System Info (read-only) -->
      <Card>
        <CardHeader>
          <div class="flex items-center gap-3">
            <FolderOpen class="h-5 w-5 text-primary" />
            <div>
              <CardTitle class="text-[15px]">System</CardTitle>
              <CardDescription>Read-only information</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-[13px] text-text-secondary">Data Directory</span>
            <code class="text-[11px] text-text-primary bg-bg-secondary px-2 py-1 rounded">{{ data?.dataDir }}</code>
          </div>
        </CardContent>
      </Card>

      <!-- Backup & Restore -->
      <Card>
        <CardHeader>
          <div class="flex items-center gap-3">
            <Archive class="h-5 w-5 text-primary" />
            <div>
              <CardTitle class="text-[15px]">Backup & Restore</CardTitle>
              <CardDescription>Create and manage database backups</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="flex items-center gap-3">
            <Button :disabled="backupCreating" @click="handleCreateBackup" variant="outline" size="sm">
              <Archive class="h-4 w-4 mr-1" />
              {{ backupCreating ? 'Creating...' : 'Create Backup' }}
            </Button>
          </div>

          <div v-if="backupSuccess" class="flex items-center gap-1.5 text-[13px] text-success">
            <CheckCircle class="h-4 w-4" />
            {{ backupSuccess }}
          </div>
          <div v-if="backupError" class="flex items-center gap-1.5 text-[13px] text-destructive">
            <AlertCircle class="h-4 w-4" />
            {{ backupError }}
          </div>

          <div v-if="backupsLoading" class="text-[13px] text-text-secondary">Loading backups...</div>

          <div v-else-if="backups.length === 0" class="text-[13px] text-text-secondary">
            No backups yet. Create one to get started.
          </div>

          <div v-else class="space-y-2">
            <div
              v-for="backup in backups"
              :key="backup.filename"
              class="flex items-center justify-between bg-bg-secondary rounded-md px-3 py-2"
            >
              <div class="min-w-0 flex-1">
                <p class="text-[13px] text-text-primary font-medium truncate">{{ backup.filename }}</p>
                <p class="text-[11px] text-text-secondary">
                  {{ formatBackupDate(backup.createdAt) }} &middot; {{ formatFileSize(backup.size) }}
                </p>
              </div>
              <div class="flex items-center gap-1 ml-3 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 w-7 p-0"
                  @click="handleDownloadBackup(backup.filename)"
                  title="Download"
                >
                  <Download class="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 w-7 p-0"
                  :disabled="backupRestoring === backup.filename"
                  @click="handleRestore(backup.filename)"
                  :title="confirmRestore === backup.filename ? 'Click again to confirm restore' : 'Restore'"
                  :class="confirmRestore === backup.filename ? 'text-warning' : ''"
                >
                  <RotateCcw class="h-3.5 w-3.5" :class="backupRestoring === backup.filename ? 'animate-spin' : ''" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 w-7 p-0 text-destructive"
                  @click="handleDeleteBackup(backup.filename)"
                  title="Delete"
                >
                  <Trash2 class="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <p v-if="confirmRestore" class="text-[11px] text-warning">
              Click restore again to confirm. This will overwrite the current database and requires a restart.
            </p>
          </div>
        </CardContent>
      </Card>

      <!-- Save -->
      <div class="flex items-center gap-3">
        <Button :disabled="saving" @click="save">
          <Save class="h-4 w-4 mr-1" />
          {{ saving ? 'Saving...' : 'Save Settings' }}
        </Button>
        <div v-if="success" class="flex items-center gap-1.5 text-[13px] text-success">
          <CheckCircle class="h-4 w-4" />
          {{ success }}
        </div>
        <div v-if="error" class="flex items-center gap-1.5 text-[13px] text-destructive">
          <AlertCircle class="h-4 w-4" />
          {{ error }}
        </div>
      </div>
    </template>

    <!-- Demo mode toggle — subtle, at the very bottom -->
    <div v-if="!loading" class="pt-8 flex items-center gap-2.5">
      <Switch
        :model-value="demoMode"
        :disabled="togglingDemo"
        @update:model-value="handleDemoToggle"
      />
      <span class="text-[11px] text-text-secondary select-none">Demo mode</span>
    </div>
  </div>
</template>
