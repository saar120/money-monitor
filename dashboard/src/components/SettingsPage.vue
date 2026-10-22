<script setup lang="ts">
import SelectField from '@/components/ui/select/SelectField.vue';
import { ref, onMounted, onUnmounted, computed } from 'vue';
import {
  getSettings,
  updateSettings,
  toggleDemoMode,
  getAIProviders,
  anthropicOAuth,
  openaiCodexOAuth,
  type SettingsResponse,
  type AIProvider,
} from '../api/client';
import { useOAuth } from '../composables/useOAuth';
import HouseholdSettings from './HouseholdSettings.vue';
import MobileAccessSettings from './MobileAccessSettings.vue';
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
import { themeChoice, setThemeChoice, type ThemeChoice } from '@/lib/theme';
import {
  language,
  languageChoice,
  setLanguageChoice,
  t,
  type LanguageChoice,
} from '@/lib/language';

const sectionCopy = computed(() =>
  language.value === 'he'
    ? {
        household: 'משק בית',
        general: 'כללי',
        appearance: 'מראה',
        appearanceHint: 'בחירת מראה האפליקציה',
        followSystem: 'לפי המכשיר',
        light: 'בהיר',
        dark: 'כהה',
        ai: 'בינה מלאכותית',
        mobile: 'גישה מהטלפון',
        security: 'אבטחה',
        sync: 'סנכרון',
        integrations: 'שילובים',
        updates: 'עדכונים',
        data: 'נתונים',
        save: 'שמירת הגדרות',
        saving: 'שומר…',
        loading: 'טוען הגדרות…',
        aiHint: 'בחירת ספק ומודל',
        securityHint: 'מפתח הצפנה ופרטי גישה',
        syncHint: 'תזמון וסנכרון חשבונות',
        integrationsHint: 'חיבור לטלגרם',
        updatesHint: 'גרסת האפליקציה ועדכונים',
        dataHint: 'מידע לקריאה בלבד',
      }
    : {
        household: 'Household',
        general: 'General',
        appearance: 'Appearance',
        appearanceHint: 'Choose how the app looks',
        followSystem: 'Follow system',
        light: 'Light',
        dark: 'Dark',
        ai: 'AI',
        mobile: 'Mobile access',
        security: 'Security',
        sync: 'Sync',
        integrations: 'Integrations',
        updates: 'Updates',
        data: 'Data',
        save: 'Save settings',
        saving: 'Saving…',
        loading: 'Loading settings…',
        aiHint: 'Choose your AI provider and model',
        securityHint: 'Encryption and access',
        syncHint: 'Account sync schedule',
        integrationsHint: 'Telegram connection',
        updatesHint: 'App version and updates',
        dataHint: 'Read-only information',
      },
);

function localized(english: string, hebrew: string) {
  return language.value === 'he' ? hebrew : english;
}

function onLanguageChange(value: string) {
  setLanguageChoice(value as LanguageChoice);
}

function onThemeChange(value: string) {
  setThemeChoice(value as ThemeChoice);
}

const activeTab = ref<'general' | 'connections' | 'advanced'>('general');
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
  AI_THINKING_LEVEL: 'off',
  AI_BATCH_PROVIDER: '',
  AI_BATCH_MODEL_ID: '',
  AI_BATCH_THINKING_LEVEL: 'inherit',
  CATEGORIZATION_PROVIDER: 'llm',
  TYPESAFE_API_KEY: '',
  OPENAI_API_KEY: '',
  OPENCODE_API_KEY: '',
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
const currentModel = computed(() =>
  currentProvider.value?.models.find(
    (model) =>
      model.id ===
      (form.value.AI_CHAT_MODEL ||
        (form.value.AI_PROVIDER === 'anthropic' ? form.value.ANTHROPIC_MODEL : '')),
  ),
);
const supportsCurrentModelThinking = computed(() => currentModel.value?.reasoning ?? false);
const batchProvider = computed(() =>
  providers.value.find((p) => p.id === (form.value.AI_BATCH_PROVIDER || form.value.AI_PROVIDER)),
);
const batchModel = computed(() =>
  batchProvider.value?.models.find((model) => model.id === form.value.AI_BATCH_MODEL_ID),
);
const supportsBatchModelThinking = computed(() => batchModel.value?.reasoning ?? false);
const useTypeSafeCategorization = computed({
  get: () => form.value.CATEGORIZATION_PROVIDER === 'typesafe',
  set: (enabled: boolean) => {
    form.value.CATEGORIZATION_PROVIDER = enabled ? 'typesafe' : 'llm';
  },
});
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
    form.value.AI_CHAT_MODEL = String(
      s.AI_CHAT_MODEL || (form.value.AI_PROVIDER === 'anthropic' ? form.value.ANTHROPIC_MODEL : ''),
    );
    form.value.AI_THINKING_LEVEL = String(s.AI_THINKING_LEVEL || 'off');
    form.value.AI_BATCH_PROVIDER = String(s.AI_BATCH_PROVIDER || '');
    form.value.AI_BATCH_MODEL_ID = String(s.AI_BATCH_MODEL_ID || '');
    form.value.AI_BATCH_THINKING_LEVEL = String(s.AI_BATCH_THINKING_LEVEL || 'inherit');
    form.value.CATEGORIZATION_PROVIDER = String(s.CATEGORIZATION_PROVIDER || 'llm');
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
    error.value = localized(
      e instanceof Error ? e.message : 'Failed to load settings',
      'לא ניתן לטעון את ההגדרות. נסו לפתוח את המסך מחדש.',
    );
  } finally {
    loading.value = false;
  }

  // Auto-update listener
  if (electronAPI?.getAutoUpdateEnabled) {
    try {
      autoUpdateEnabled.value = await electronAPI.getAutoUpdateEnabled();
    } catch {
      updateStatus.value = 'unavailable';
    }
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
      getAppVersion: () => string;
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
const appVersion = electronAPI?.getAppVersion?.() ?? '';
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
  try {
    await electronAPI?.setAutoUpdateEnabled(enabled);
  } catch (cause) {
    autoUpdateEnabled.value = !enabled;
    error.value = localized(
      cause instanceof Error ? cause.message : t('couldNotLoad'),
      'לא ניתן לעדכן את הגדרות העדכון. נסו שוב.',
    );
  }
}

async function manualCheckForUpdates() {
  updateStatus.value = 'checking';
  updateError.value = '';
  try {
    await electronAPI?.checkForUpdates();
  } catch (cause) {
    updateStatus.value = 'error';
    updateError.value = cause instanceof Error ? cause.message : t('couldNotLoad');
  }
}

function installUpdate() {
  electronAPI?.installUpdate();
}

const updateStatusText = computed(() => {
  switch (updateStatus.value) {
    case 'checking':
      return localized('Checking for updates...', 'בודק עדכונים…');
    case 'available':
      return localized(
        `Update v${updateVersion.value} available`,
        `גרסה ${updateVersion.value} זמינה לעדכון`,
      );
    case 'downloading':
      return localized(
        `Downloading update... ${Math.round(updatePercent.value)}%`,
        `מוריד עדכון… ${Math.round(updatePercent.value)}%`,
      );
    case 'ready':
      return localized(
        `v${updateVersion.value} ready to install`,
        `גרסה ${updateVersion.value} מוכנה להתקנה`,
      );
    case 'up-to-date':
      return localized('App is up to date', 'האפליקציה מעודכנת');
    case 'unavailable':
      return language.value === 'he'
        ? 'עדכונים זמינים בגרסה המותקנת של האפליקציה.'
        : 'Updates are available in the installed release.';
    case 'error':
      return localized(`Update error: ${updateError.value}`, 'העדכון נכשל. נסו לבדוק שוב.');
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
    error.value = localized(
      e instanceof Error ? e.message : 'Failed to toggle demo mode',
      'לא ניתן לשנות את מצב ההדגמה. נסו שוב.',
    );
    togglingDemo.value = false;
  }
}

// ── OAuth ───────────────────────────────────────────────────────────────────

const oauthConnected = computed(() => data.value?.oauth?.anthropic ?? false);
const { oauthStep, oauthCode, oauthError, startOAuth, submitOAuthCode, cancelOAuth } = useOAuth(
  anthropicOAuth,
  {
    onSuccess: () => {
      if (data.value) data.value.oauth.anthropic = true;
    },
  },
);

const openaiCodexOAuthConnected = computed(() => data.value?.oauth?.['openai-codex'] ?? false);
const loggingOutOpenai = ref(false);
const {
  oauthStep: openaiOAuthStep,
  oauthCode: openaiOAuthCode,
  oauthError: openaiOAuthError,
  startOAuth: startOpenaiOAuth,
  submitOAuthCode: submitOpenaiOAuthCode,
  cancelOAuth: cancelOpenaiOAuth,
} = useOAuth(openaiCodexOAuth, {
  onSuccess: () => {
    if (data.value) data.value.oauth['openai-codex'] = true;
  },
});

async function logoutOpenaiOAuth() {
  loggingOutOpenai.value = true;
  error.value = '';
  try {
    await openaiCodexOAuth.logout();
    if (data.value) data.value.oauth['openai-codex'] = false;
  } catch (e) {
    error.value = localized(
      e instanceof Error ? e.message : 'Failed to log out of ChatGPT',
      'לא ניתן להתנתק מ-ChatGPT. נסו שוב.',
    );
  } finally {
    loggingOutOpenai.value = false;
  }
}

// ── Save ─────────────────────────────────────────────────────────────────────

async function save() {
  saving.value = true;
  error.value = '';
  success.value = '';
  try {
    const updates: Record<string, string | number | boolean> = {
      APP_LANGUAGE: languageChoice.value,
      APP_THEME: themeChoice.value,
      ANTHROPIC_MODEL: form.value.ANTHROPIC_MODEL,
      AI_PROVIDER: form.value.AI_PROVIDER,
      AI_CHAT_MODEL: form.value.AI_CHAT_MODEL,
      AI_THINKING_LEVEL: form.value.AI_THINKING_LEVEL,
      AI_BATCH_PROVIDER: useSeparateBatch.value ? form.value.AI_BATCH_PROVIDER : '',
      AI_BATCH_MODEL_ID: useSeparateBatch.value ? form.value.AI_BATCH_MODEL_ID : '',
      AI_BATCH_THINKING_LEVEL: useSeparateBatch.value
        ? form.value.AI_BATCH_THINKING_LEVEL
        : 'inherit',
      CATEGORIZATION_PROVIDER: form.value.CATEGORIZATION_PROVIDER,
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
      'OPENCODE_API_KEY',
      'GEMINI_API_KEY',
      'OPENROUTER_API_KEY',
      'TYPESAFE_API_KEY',
    ] as const;
    for (const key of secretKeys) {
      if (dirtySecrets.value.has(key) && form.value[key]) {
        updates[key] = form.value[key] as string;
      }
    }
    await updateSettings(updates);
    success.value = localized(
      'Settings saved. Some changes may require a restart.',
      'ההגדרות נשמרו. ייתכן שצריך להפעיל מחדש את האפליקציה כדי להחיל חלק מהשינויים.',
    );
    dirtySecrets.value.clear();
  } catch (e) {
    error.value = localized(
      e instanceof Error ? e.message : 'Failed to save settings',
      'לא ניתן לשמור את ההגדרות. נסו שוב.',
    );
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="settings-page w-full min-w-0 mx-auto pb-8 space-y-8">
    <div v-if="loading" class="text-text-secondary">{{ sectionCopy.loading }}</div>

    <template v-else>
      <nav class="settings-index flex flex-wrap gap-2" :aria-label="t('settings')">
        <Button
          v-for="tab in ['general', 'connections', 'advanced'] as const"
          :key="tab"
          :variant="activeTab === tab ? 'default' : 'ghost'"
          :aria-pressed="activeTab === tab"
          :data-settings-tab="tab"
          @click="activeTab = tab"
        >
          {{
            tab === 'general'
              ? sectionCopy.general
              : tab === 'connections'
                ? language === 'he'
                  ? 'חיבורים'
                  : 'Connections'
                : language === 'he'
                  ? 'מתקדם'
                  : 'Advanced'
          }}
        </Button>
      </nav>
      <p class="text-text-secondary">
        {{
          activeTab === 'general'
            ? language === 'he'
              ? 'העדפות אישיות ומשק הבית שלכם.'
              : 'Your preferences and household.'
            : activeTab === 'connections'
              ? language === 'he'
                ? 'חיבור היועץ והטלפון שלכם.'
                : 'Connect your Advisor and iPhone.'
              : language === 'he'
                ? 'הגדרות טכניות לסנכרון, עיבוד נתונים ושילובים.'
                : 'Technical controls for account refreshes, AI processing, and integrations.'
        }}
      </p>
      <SettingsGroup
        v-show="activeTab === 'general'"
        id="settings-general"
        :title="sectionCopy.general"
      >
        <SettingsRow :label="t('appLanguage')">
          <SelectField
            :model-value="languageChoice"
            class="ledger-select"
            :aria-label="t('appLanguage')"
            :options="[
              { value: 'system', label: t('systemDefault') },
              { value: 'en', label: t('english') },
              { value: 'he', label: t('hebrew') },
            ]"
            @update:model-value="onLanguageChange"
          />
        </SettingsRow>
        <SettingsRow :label="sectionCopy.appearance" :description="sectionCopy.appearanceHint">
          <SelectField
            :model-value="themeChoice"
            class="ledger-select"
            :aria-label="sectionCopy.appearance"
            :options="[
              { value: 'system', label: sectionCopy.followSystem },
              { value: 'light', label: sectionCopy.light },
              { value: 'dark', label: sectionCopy.dark },
            ]"
            @update:model-value="onThemeChange"
          />
        </SettingsRow>
      </SettingsGroup>

      <section v-show="activeTab !== 'connections'" id="settings-household">
        <HouseholdSettings :section="activeTab === 'advanced' ? 'rules' : 'members'" />
      </section>

      <template v-if="!isElectron">
        <p class="border-y border-separator px-5 py-6 text-sm leading-relaxed text-text-secondary">
          {{
            localized(
              'Settings are managed via the .env file in standalone mode. Edit .env and restart the server to apply changes.',
              'בהפעלה עצמאית, ההגדרות מנוהלות בקובץ .env. ערכו את הקובץ והפעילו מחדש את השרת כדי להחיל את השינויים.',
            )
          }}
        </p>
      </template>

      <template v-else>
        <Teleport to="#toolbar-actions">
          <div class="flex flex-wrap items-center gap-2">
            <div v-if="success" class="flex items-center gap-1.5 text-[14px] text-success">
              <CheckCircle class="h-3.5 w-3.5" />
              {{ success }}
            </div>
            <div v-if="error" class="flex items-center gap-1.5 text-[14px] text-destructive">
              <AlertCircle class="h-3.5 w-3.5" />
              {{ error }}
            </div>
            <Button size="sm" :disabled="saving" @click="save">
              {{ saving ? sectionCopy.saving : sectionCopy.save }}
            </Button>
          </div>
        </Teleport>

        <section v-show="activeTab === 'connections'" id="settings-mobile">
          <MobileAccessSettings />
        </section>
        <SettingsGroup
          v-show="activeTab === 'general'"
          :title="language === 'he' ? 'רענון חשבונות' : 'Account refreshes'"
        >
          <SettingsRow
            :label="language === 'he' ? 'תזמון' : 'Schedule'"
            :description="
              language === 'he'
                ? 'הרענון מתבצע כשהאפליקציה פועלת. אפשר להגדיר שעות אחרות בלשונית מתקדם.'
                : 'Refreshes run while the app is open. Custom schedules are available in Advanced.'
            "
          >
            <SelectField
              v-model="form.SCRAPE_CRON"
              :aria-label="language === 'he' ? 'תזמון רענון' : 'Refresh schedule'"
              :options="[
                {
                  value: '0 6 * * *',
                  label: language === 'he' ? 'כל יום ב־06:00' : 'Every day at 06:00',
                },
                {
                  value: '0 18 * * *',
                  label: language === 'he' ? 'כל יום ב־18:00' : 'Every day at 18:00',
                },
                {
                  value: '0 6,18 * * *',
                  label:
                    language === 'he'
                      ? 'פעמיים ביום, ב־06:00 וב־18:00'
                      : 'Twice daily, at 06:00 and 18:00',
                },
                ...(!['0 6 * * *', '0 18 * * *', '0 6,18 * * *'].includes(form.SCRAPE_CRON)
                  ? [
                      {
                        value: form.SCRAPE_CRON,
                        label: language === 'he' ? 'תזמון מותאם אישית' : 'Custom schedule',
                      },
                    ]
                  : []),
              ]"
            />
          </SettingsRow>
          <SettingsRow :label="language === 'he' ? 'אזור זמן' : 'Time zone'">
            <span class="text-text-secondary">{{ form.SCRAPE_TIMEZONE }}</span>
          </SettingsRow>
        </SettingsGroup>
        <!-- AI Configuration -->
        <SettingsGroup
          v-show="activeTab === 'connections'"
          id="settings-ai"
          :title="sectionCopy.ai"
          :description="sectionCopy.aiHint"
        >
          <SettingsRow class="bg-bg-secondary/50">
            <div
              class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-secondary"
            >
              <span
                >{{ localized('Provider:', 'ספק:') }}
                <strong class="text-text-primary">{{
                  currentProvider?.name ?? form.AI_PROVIDER
                }}</strong></span
              >
              <span
                >{{ localized('Model:', 'מודל:') }}
                <strong class="text-text-primary">{{
                  form.AI_CHAT_MODEL || form.ANTHROPIC_MODEL || localized('default', 'ברירת מחדל')
                }}</strong></span
              >
              <span v-if="form.AI_PROVIDER === 'anthropic'">
                {{ localized('Auth:', 'חיבור:') }}
                <strong v-if="oauthConnected" class="text-text-primary">{{
                  localized('OAuth', 'חיבור דרך החשבון')
                }}</strong>
                <strong
                  v-else-if="data?.settings?.ANTHROPIC_OAUTH_TOKEN"
                  class="text-text-primary"
                  >{{ localized('Token', 'אסימון גישה') }}</strong
                >
                <strong v-else-if="data?.settings?.ANTHROPIC_API_KEY" class="text-text-primary">{{
                  localized('API Key', 'מפתח API')
                }}</strong>
                <strong v-else class="text-destructive">{{
                  localized('Not set', 'לא הוגדר')
                }}</strong>
              </span>
              <span v-else-if="form.AI_PROVIDER === 'openai-codex'">
                {{ localized('Auth:', 'חיבור:') }}
                <strong v-if="openaiCodexOAuthConnected" class="text-text-primary">{{
                  localized('OAuth', 'חיבור דרך החשבון')
                }}</strong>
                <strong v-else class="text-destructive">{{
                  localized('Not connected', 'לא מחובר')
                }}</strong>
              </span>
              <span v-else>
                {{ localized('Auth:', 'חיבור:') }}
                <strong v-if="currentProvider?.hasKey" class="text-text-primary">{{
                  localized('API Key', 'מפתח API')
                }}</strong>
                <strong v-else class="text-destructive">{{
                  localized('Not set', 'לא הוגדר')
                }}</strong>
              </span>
            </div>
          </SettingsRow>

          <SettingsRow :label="localized('Provider', 'ספק בינה מלאכותית')">
            <Select v-model="form.AI_PROVIDER">
              <SelectTrigger>
                <SelectValue :placeholder="localized('Select provider', 'בחירת ספק')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="p in providers" :key="p.id" :value="p.id">
                  {{ p.name }}
                  <span v-if="p.hasKey" class="ml-1 text-green-500">&#10003;</span>
                </SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>

          <SettingsRow
            v-if="currentProvider?.authTypes?.includes('api_key')"
            :label="
              localized(
                `${currentProvider?.name ?? 'API'} Key`,
                `מפתח API של ${currentProvider?.name ?? 'הספק'}`,
              )
            "
          >
            <Input
              type="password"
              class="w-full sm:w-52"
              :model-value="form[currentApiKeyField] as string"
              :placeholder="
                data?.settings?.[currentApiKeyField]
                  ? String(data.settings[currentApiKeyField])
                  : localized('Not set', 'לא הוגדר')
              "
              @update:model-value="
                (v: string | number) => {
                  (form[currentApiKeyField] as any) = String(v);
                  markDirty(currentApiKeyField);
                }
              "
            />
            <p
              v-if="form.AI_PROVIDER === 'opencode-go'"
              class="mt-1 text-[12px] leading-relaxed text-text-secondary"
            >
              {{
                localized(
                  'Use your OpenCode Go API key. Models use OpenCode’s OpenAI-compatible Go endpoint.',
                  'הזינו מפתח API של OpenCode Go. המודלים מתחברים דרך ממשק Go שתואם ל-OpenAI.',
                )
              }}
              <a
                href="https://opencode.ai/zen/go"
                target="_blank"
                rel="noopener noreferrer"
                class="underline"
                >{{ localized('Learn more', 'מידע נוסף') }}</a
              >
            </p>
          </SettingsRow>

          <!-- Anthropic OAuth section -->
          <template v-if="form.AI_PROVIDER === 'anthropic'">
            <SettingsRow vertical>
              <div class="relative flex items-center justify-center">
                <div class="absolute border-t w-full" />
                <span class="relative bg-bg-primary px-2 text-xs text-text-secondary">{{
                  localized('or', 'או')
                }}</span>
              </div>

              <div
                v-if="oauthConnected && oauthStep === 'idle'"
                class="flex items-center gap-2 text-[14px]"
              >
                <CheckCircle class="h-4 w-4 text-green-500" />
                <span class="text-text-secondary">{{
                  localized('Anthropic OAuth connected', 'החשבון ב-Anthropic מחובר')
                }}</span>
              </div>

              <div v-else-if="oauthStep === 'idle'" class="space-y-1.5">
                <Button variant="secondary" size="sm" class="w-full" @click="startOAuth">
                  {{ localized('Login with Anthropic', 'התחברות ל-Anthropic') }}
                </Button>
                <p class="text-[12px] text-text-secondary">
                  {{
                    localized(
                      'Use your Anthropic account instead of an API key',
                      'התחברות דרך חשבון Anthropic במקום מפתח API',
                    )
                  }}
                </p>
              </div>

              <div v-else-if="oauthStep === 'waiting_code'" class="space-y-2">
                <p class="text-[12px] text-text-secondary">
                  {{
                    localized(
                      'A browser window has been opened. After authorizing, paste the code below:',
                      'נפתח חלון בדפדפן. אשרו את החיבור והדביקו כאן את הקוד שתקבלו:',
                    )
                  }}
                </p>
                <div class="flex flex-col gap-2 sm:flex-row">
                  <Input
                    v-model="oauthCode"
                    :placeholder="localized('Paste authorization code...', 'הדבקת קוד האישור…')"
                    class="flex-1"
                    @keydown.enter="submitOAuthCode"
                  />
                  <Button size="sm" :disabled="!oauthCode.trim()" @click="submitOAuthCode">
                    {{ localized('Submit', 'אישור') }}
                  </Button>
                </div>
                <button class="text-[12px] text-text-secondary underline" @click="cancelOAuth">
                  {{ localized('Cancel', 'ביטול') }}
                </button>
              </div>

              <div v-else-if="oauthStep === 'submitting'" class="text-[12px] text-text-secondary">
                {{ localized('Verifying authorization...', 'מאמת את החיבור…') }}
              </div>

              <p v-if="oauthError" class="text-[12px] text-destructive">
                {{ localized(oauthError, 'החיבור ל-Anthropic לא הושלם. נסו להתחבר שוב.') }}
              </p>
            </SettingsRow>
          </template>

          <!-- OpenAI Codex (ChatGPT subscription) OAuth section -->
          <template v-if="form.AI_PROVIDER === 'openai-codex'">
            <SettingsRow vertical>
              <div v-if="openaiCodexOAuthConnected && openaiOAuthStep === 'idle'" class="space-y-2">
                <div class="flex items-center gap-2 text-[14px]">
                  <CheckCircle class="h-4 w-4 text-green-500" />
                  <span class="text-text-secondary">{{
                    localized('ChatGPT subscription connected', 'מנוי ChatGPT מחובר')
                  }}</span>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  class="w-full"
                  :disabled="loggingOutOpenai"
                  @click="logoutOpenaiOAuth"
                >
                  {{
                    loggingOutOpenai
                      ? localized('Logging out...', 'מתנתק…')
                      : localized('Log out of ChatGPT', 'התנתקות מ-ChatGPT')
                  }}
                </Button>
              </div>

              <div v-else-if="openaiOAuthStep === 'idle'" class="space-y-1.5">
                <Button variant="secondary" size="sm" class="w-full" @click="startOpenaiOAuth">
                  {{ localized('Login with ChatGPT', 'התחברות ל-ChatGPT') }}
                </Button>
                <p class="text-[12px] text-text-secondary">
                  {{
                    localized(
                      'Use your ChatGPT Plus or Pro subscription',
                      'התחברות באמצעות מנוי ChatGPT Plus או Pro',
                    )
                  }}
                </p>
              </div>

              <div v-else-if="openaiOAuthStep === 'waiting_code'" class="space-y-2">
                <p class="text-[12px] text-text-secondary">
                  {{
                    localized(
                      'A browser window has been opened. After authorizing, paste the code below:',
                      'נפתח חלון בדפדפן. אשרו את החיבור והדביקו כאן את הקוד שתקבלו:',
                    )
                  }}
                </p>
                <div class="flex flex-col gap-2 sm:flex-row">
                  <Input
                    v-model="openaiOAuthCode"
                    :placeholder="
                      localized(
                        'Paste authorization code or redirect URL...',
                        'הדבקת קוד האישור או כתובת ההפניה…',
                      )
                    "
                    class="flex-1"
                    @keydown.enter="submitOpenaiOAuthCode"
                  />
                  <Button
                    size="sm"
                    :disabled="!openaiOAuthCode.trim()"
                    @click="submitOpenaiOAuthCode"
                  >
                    {{ localized('Submit', 'אישור') }}
                  </Button>
                </div>
                <button
                  class="text-[12px] text-text-secondary underline"
                  @click="cancelOpenaiOAuth"
                >
                  {{ localized('Cancel', 'ביטול') }}
                </button>
              </div>

              <div
                v-else-if="openaiOAuthStep === 'submitting'"
                class="text-[12px] text-text-secondary"
              >
                {{ localized('Verifying authorization...', 'מאמת את החיבור…') }}
              </div>

              <p v-if="openaiOAuthError" class="text-[12px] text-destructive">
                {{ localized(openaiOAuthError, 'החיבור ל-ChatGPT לא הושלם. נסו להתחבר שוב.') }}
              </p>
            </SettingsRow>
          </template>

          <SettingsRow :label="localized('Chat Model', 'מודל לשיחות')">
            <Select v-model="form.AI_CHAT_MODEL">
              <SelectTrigger>
                <SelectValue :placeholder="localized('Select model', 'בחירת מודל')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="m in currentProvider?.models ?? []" :key="m.id" :value="m.id">
                  {{ m.name }}
                </SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup
          v-show="activeTab === 'advanced'"
          :title="language === 'he' ? 'עיבוד בינה מלאכותית' : 'AI processing'"
          :description="
            language === 'he' ? 'הגדרות הסיווג והיועץ' : 'Fine-tune categorization and reasoning'
          "
        >
          <SettingsRow v-if="form.AI_PROVIDER === 'anthropic'" vertical>
            <!-- Manual OAuth token paste -->
            <div class="space-y-1.5">
              <label
                for="settings-page-field-1"
                class="text-[14px] font-medium text-text-primary block"
                >{{ localized('OAuth Token', 'אסימון גישה (OAuth)') }}</label
              >
              <Input
                id="settings-page-field-1"
                v-model="form.ANTHROPIC_OAUTH_TOKEN"
                type="password"
                :placeholder="
                  data?.settings?.ANTHROPIC_OAUTH_TOKEN
                    ? String(data.settings.ANTHROPIC_OAUTH_TOKEN)
                    : localized('Not set', 'לא הוגדר')
                "
                @input="markDirty('ANTHROPIC_OAUTH_TOKEN')"
              />
              <p class="text-[12px] text-text-secondary mt-1">
                {{
                  localized(
                    'Paste an OAuth token directly (e.g. from Claude Code CLI)',
                    'הדבקה ידנית של אסימון OAuth, למשל מ-Claude Code CLI',
                  )
                }}
              </p>
            </div>
          </SettingsRow>
          <SettingsRow
            v-if="supportsCurrentModelThinking"
            :label="localized('Thinking Level', 'רמת חשיבה')"
            :description="
              localized(
                'Higher levels may improve complex answers but increase time and usage',
                'רמה גבוהה יותר עשויה לשפר תשובות מורכבות, אך דורשת יותר זמן ומשאבים',
              )
            "
          >
            <Select v-model="form.AI_THINKING_LEVEL">
              <SelectTrigger>
                <SelectValue :placeholder="localized('Select thinking level', 'בחירת רמת חשיבה')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">{{ localized('Off', 'כבויה') }}</SelectItem>
                <SelectItem value="minimal">{{ localized('Minimal', 'מזערית') }}</SelectItem>
                <SelectItem value="low">{{ localized('Low', 'נמוכה') }}</SelectItem>
                <SelectItem value="medium">{{ localized('Medium', 'בינונית') }}</SelectItem>
                <SelectItem value="high">{{ localized('High', 'גבוהה') }}</SelectItem>
                <SelectItem value="xhigh">{{ localized('Extra high', 'גבוהה מאוד') }}</SelectItem>
                <SelectItem value="max">{{ localized('Maximum', 'מרבית') }}</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>

          <SettingsRow
            :label="localized('TypeSafe Categorization', 'סיווג באמצעות TypeSafe')"
            :description="
              localized(
                'Use TypeSafe instead of the configured AI batch model for transaction categorization',
                'סיווג תנועות באמצעות TypeSafe במקום המודל שהוגדר למשימות רקע',
              )
            "
          >
            <Switch v-model="useTypeSafeCategorization" />
          </SettingsRow>

          <SettingsRow
            v-if="useTypeSafeCategorization"
            :label="localized('TypeSafe API Key', 'מפתח API של TypeSafe')"
          >
            <Input
              v-model="form.TYPESAFE_API_KEY"
              type="password"
              class="w-full sm:w-52"
              :placeholder="
                data?.settings.TYPESAFE_API_KEY
                  ? String(data.settings.TYPESAFE_API_KEY)
                  : localized('Not set', 'לא הוגדר')
              "
              @input="markDirty('TYPESAFE_API_KEY')"
            />
          </SettingsRow>

          <SettingsRow
            v-if="!useTypeSafeCategorization"
            :label="localized('Separate Batch Model', 'מודל נפרד למשימות רקע')"
          >
            <Switch v-model="useSeparateBatch" />
          </SettingsRow>

          <template v-if="!useTypeSafeCategorization && useSeparateBatch">
            <SettingsRow :label="localized('Batch Provider', 'ספק למשימות רקע')">
              <Select v-model="form.AI_BATCH_PROVIDER">
                <SelectTrigger>
                  <SelectValue :placeholder="localized('Select provider', 'בחירת ספק')" />
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
              :label="
                localized(
                  `${batchProvider?.name ?? 'API'} Key`,
                  `מפתח API של ${batchProvider?.name ?? 'הספק'}`,
                )
              "
            >
              <Input
                type="password"
                class="w-full sm:w-52"
                :model-value="form[batchApiKeyField] as string"
                :placeholder="
                  data?.settings?.[batchApiKeyField]
                    ? String(data.settings[batchApiKeyField])
                    : localized('Not set', 'לא הוגדר')
                "
                @update:model-value="
                  (v: string | number) => {
                    (form[batchApiKeyField] as any) = String(v);
                    markDirty(batchApiKeyField);
                  }
                "
              />
            </SettingsRow>

            <SettingsRow :label="localized('Batch Model', 'מודל למשימות רקע')">
              <Select v-model="form.AI_BATCH_MODEL_ID">
                <SelectTrigger>
                  <SelectValue :placeholder="localized('Select model', 'בחירת מודל')" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="m in batchProvider?.models ?? []" :key="m.id" :value="m.id">
                    {{ m.name }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>

            <SettingsRow
              v-if="supportsBatchModelThinking"
              :label="localized('Batch Thinking Level', 'רמת חשיבה למשימות רקע')"
              :description="
                localized(
                  'Use a separate level for categorization and other batch jobs',
                  'רמת חשיבה נפרדת לסיווג תנועות ולמשימות רקע נוספות',
                )
              "
            >
              <Select v-model="form.AI_BATCH_THINKING_LEVEL">
                <SelectTrigger>
                  <SelectValue
                    :placeholder="
                      localized('Select batch thinking level', 'בחירת רמת חשיבה למשימות רקע')
                    "
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">{{
                    localized('Use chat setting', 'כמו בשיחות')
                  }}</SelectItem>
                  <SelectItem value="off">{{ localized('Off', 'כבויה') }}</SelectItem>
                  <SelectItem value="minimal">{{ localized('Minimal', 'מזערית') }}</SelectItem>
                  <SelectItem value="low">{{ localized('Low', 'נמוכה') }}</SelectItem>
                  <SelectItem value="medium">{{ localized('Medium', 'בינונית') }}</SelectItem>
                  <SelectItem value="high">{{ localized('High', 'גבוהה') }}</SelectItem>
                  <SelectItem value="xhigh">{{ localized('Extra high', 'גבוהה מאוד') }}</SelectItem>
                  <SelectItem value="max">{{ localized('Maximum', 'מרבית') }}</SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>
          </template>

          <SettingsRow
            :label="localized('Advisor work limit', 'מגבלת עבודה ליועץ')"
            :description="
              localized(
                'Maximum tool rounds per reply (1–20)',
                'מספר סבבי הכלים המרבי לכל תשובה (1–20)',
              )
            "
          >
            <Input v-model="form.AI_MAX_TURNS" type="number" min="1" max="20" class="w-20" />
          </SettingsRow>
        </SettingsGroup>

        <!-- Security -->
        <SettingsGroup
          v-show="activeTab === 'advanced'"
          id="settings-security"
          :title="sectionCopy.security"
          :description="
            localized('Encryption key for bank credentials', 'מפתח ההצפנה של פרטי הכניסה לבנק')
          "
        >
          <SettingsRow
            :label="localized('Master Key', 'מפתח הצפנה ראשי')"
            :description="
              localized(
                'Changing this makes existing encrypted credentials unreadable',
                'שינוי המפתח ימנע קריאה של פרטי הכניסה שכבר נשמרו',
              )
            "
          >
            <Input
              v-model="form.CREDENTIALS_MASTER_KEY"
              type="password"
              class="w-full sm:w-52"
              :placeholder="
                data?.settings.CREDENTIALS_MASTER_KEY
                  ? String(data.settings.CREDENTIALS_MASTER_KEY)
                  : localized('Not set', 'לא הוגדר')
              "
              @input="markDirty('CREDENTIALS_MASTER_KEY')"
            />
          </SettingsRow>
        </SettingsGroup>

        <!-- Scraping -->
        <SettingsGroup
          v-show="activeTab === 'advanced'"
          id="settings-sync"
          :title="sectionCopy.sync"
          :description="
            localized('Control when and how accounts refresh', 'מתי ואיך יתבצע רענון החשבונות')
          "
        >
          <SettingsRow :label="localized('Cron Schedule', 'תזמון מותאם (Cron)')">
            <Input v-model="form.SCRAPE_CRON" placeholder="0 6 * * *" class="w-44" />
          </SettingsRow>
          <SettingsRow :label="localized('Timezone', 'אזור זמן')">
            <Input v-model="form.SCRAPE_TIMEZONE" placeholder="Asia/Jerusalem" class="w-44" />
          </SettingsRow>
          <SettingsRow
            :label="localized('Transaction history (months)', 'כמה חודשים אחורה לייבא תנועות')"
          >
            <Input v-model="form.SCRAPE_START_DATE_MONTHS_BACK" type="number" class="w-20" />
          </SettingsRow>
          <SettingsRow
            :label="
              localized('Refresh timeout (milliseconds)', 'זמן המתנה מרבי לרענון (אלפיות שנייה)')
            "
          >
            <Input v-model="form.SCRAPE_TIMEOUT" type="number" class="w-28" />
          </SettingsRow>
          <SettingsRow
            :label="
              localized('Show browser during account refresh', 'הצגת הדפדפן בזמן רענון חשבונות')
            "
          >
            <Switch v-model="form.SCRAPE_SHOW_BROWSER" />
          </SettingsRow>
        </SettingsGroup>

        <!-- Telegram -->
        <SettingsGroup
          v-show="activeTab === 'advanced'"
          id="settings-integrations"
          :title="sectionCopy.integrations"
          :description="
            localized('Optional Telegram bot integration', 'חיבור לבוט בטלגרם, לבחירתכם')
          "
        >
          <SettingsRow :label="localized('Bot Token', 'אסימון הבוט')">
            <Input
              v-model="form.TELEGRAM_BOT_TOKEN"
              type="password"
              class="w-full sm:w-52"
              :placeholder="
                data?.settings.TELEGRAM_BOT_TOKEN
                  ? String(data.settings.TELEGRAM_BOT_TOKEN)
                  : localized('Not set', 'לא הוגדר')
              "
              @input="markDirty('TELEGRAM_BOT_TOKEN')"
            />
          </SettingsRow>
          <SettingsRow
            :label="localized('Allowed User IDs', 'מזהי משתמשים מורשים')"
            :description="localized('Comma-separated', 'מופרדים בפסיקים')"
          >
            <Input
              v-model="form.TELEGRAM_ALLOWED_USERS"
              :placeholder="localized('Comma-separated user IDs', 'מזהי משתמשים, מופרדים בפסיקים')"
              class="w-full sm:w-52"
            />
          </SettingsRow>
        </SettingsGroup>

        <!-- Updates -->
        <SettingsGroup
          v-show="activeTab === 'general'"
          id="settings-updates"
          :title="sectionCopy.updates"
          :description="localized('Automatic update settings', 'הגדרות עדכון אוטומטי')"
        >
          <SettingsRow
            v-if="!electronAPI"
            :label="language === 'he' ? 'עדכוני האפליקציה' : 'App updates'"
          >
            <p class="text-sm text-text-secondary">
              {{
                language === 'he'
                  ? 'ניהול עדכונים זמין באפליקציה למחשב.'
                  : 'Manage updates in the desktop app.'
              }}
            </p>
          </SettingsRow>
          <SettingsRow v-if="appVersion" :label="localized('Current Version', 'גרסה נוכחית')">
            <code class="text-[12px] text-text-primary bg-bg-secondary px-2 py-1 rounded break-all"
              >v{{ appVersion }}</code
            >
          </SettingsRow>
          <SettingsRow
            v-if="electronAPI"
            :label="localized('Auto-update', 'עדכון אוטומטי')"
            :description="
              localized(
                'Automatically check for and download updates',
                'בדיקה והורדה של עדכונים באופן אוטומטי',
              )
            "
          >
            <Switch :model-value="autoUpdateEnabled" @update:model-value="toggleAutoUpdate" />
          </SettingsRow>
          <SettingsRow v-if="electronAPI" :label="localized('Check for Updates', 'בדיקת עדכונים')">
            <div class="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                :disabled="checkingForUpdates || updateStatus === 'unavailable'"
                @click="manualCheckForUpdates"
              >
                <RefreshCw
                  class="h-3.5 w-3.5 mr-1.5"
                  :class="{ 'animate-spin': checkingForUpdates }"
                />
                {{ localized('Check Now', 'בדיקה עכשיו') }}
              </Button>
              <Button v-if="updateStatus === 'ready'" size="sm" @click="installUpdate">
                <Download class="h-3.5 w-3.5 mr-1.5" />
                {{ localized('Install & Restart', 'התקנה והפעלה מחדש') }}
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
        <SettingsGroup
          v-show="activeTab === 'advanced'"
          id="settings-data"
          :title="sectionCopy.data"
          :description="sectionCopy.dataHint"
        >
          <SettingsRow :label="localized('Data Directory', 'תיקיית הנתונים')">
            <code
              class="text-[12px] text-text-primary bg-bg-secondary px-2 py-1 rounded break-all"
              >{{ data?.dataDir }}</code
            >
          </SettingsRow>
        </SettingsGroup>
      </template>
    </template>

    <!-- Demo mode toggle -->
    <div v-if="!loading" v-show="activeTab === 'advanced'" class="pt-4">
      <SettingsGroup>
        <SettingsRow
          :label="localized('Demo mode', 'מצב הדגמה')"
          :description="localized('View app with sample data', 'הצגת האפליקציה עם נתונים לדוגמה')"
        >
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

<style scoped>
.settings-page {
  line-height: 1.6;
}
.settings-index {
  margin-bottom: 32px;
}
.settings-page :deep(input),
.settings-page :deep(select),
.settings-page :deep([data-slot='select-trigger']) {
  min-height: var(--control-height);
}
.settings-page :deep(code) {
  line-height: 1.7;
}
</style>
