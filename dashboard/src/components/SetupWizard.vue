<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { updateSettings, getAIProviders, type AIProvider } from '../api/client';
import { useOAuth } from '../composables/useOAuth';
import { anthropicOAuth } from '../api/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Wallet,
  ArrowRight,
  ArrowLeft,
  Key,
  MessageCircle,
  Check,
  CheckCircle,
} from 'lucide-vue-next';
import { language } from '@/lib/language';

const copy = computed(() =>
  language.value === 'he'
    ? {
        intro: 'הגדרת האפליקציה',
        provider: 'ספק בינה מלאכותית',
        providerHint: 'בחירת ספק והזנת מפתח API',
        key: 'מפתח',
        model: 'מודל',
        selectModel: 'בחירת מודל',
        or: 'או',
        opencodeHint: 'הזינו מפתח OpenCode Go. המודלים והחיבור יוגדרו אוטומטית.',
        learnMore: 'מידע נוסף',
        connected: 'חשבון Anthropic מחובר',
        login: 'כניסה עם Anthropic',
        loginHint: 'אפשר להתחבר לחשבון במקום להזין מפתח API',
        codeHint: 'חלון דפדפן נפתח. לאחר אישור הגישה, הדביקו את הקוד כאן:',
        pasteCode: 'הדבקת קוד אישור…',
        submit: 'אישור',
        cancel: 'ביטול',
        verifying: 'מאמת גישה…',
        oauthToken: 'אסימון OAuth',
        useToken: 'שימוש באסימון OAuth',
        tokenHint: 'אפשר להדביק אסימון ישירות, למשל מ־Claude Code.',
        skipLater: 'אפשר להגדיר זאת בהמשך בהגדרות.',
        encryption: 'מפתח הצפנה',
        encryptionHint: 'משמש להצפנת פרטי הכניסה לבנקים',
        auto: 'יצירה אוטומטית',
        custom: 'מפתח אישי',
        storageHint: 'המפתח נשמר בהגדרות האפליקציה ומצפין פרטי כניסה לבנקים.',
        customPlaceholder: 'הזינו מפתח עם לפחות 8 תווים',
        optional: 'הגדרות נוספות',
        optionalHint: 'אפשר לשנות אותן בכל עת בהגדרות',
        schedule: 'תזמון סנכרון (cron)',
        timezone: 'אזור זמן',
        telegram: 'אסימון בוט טלגרם',
        optionalPlaceholder: 'לא חובה',
        back: 'חזרה',
        skip: 'דילוג',
        next: 'המשך',
        finish: 'סיום ההגדרה',
        saving: 'שומר…',
      }
    : {
        intro: 'Set up your desktop app',
        provider: 'AI provider',
        providerHint: 'Choose a provider and enter an API key',
        key: 'Key',
        model: 'Model',
        selectModel: 'Select model',
        or: 'or',
        opencodeHint:
          'Enter your OpenCode Go API key. Models and the endpoint are configured automatically.',
        learnMore: 'Learn more',
        connected: 'Anthropic account connected',
        login: 'Log in with Anthropic',
        loginHint: 'Use your account instead of an API key',
        codeHint: 'A browser window opened. After authorizing, paste the code here:',
        pasteCode: 'Paste authorization code…',
        submit: 'Submit',
        cancel: 'Cancel',
        verifying: 'Verifying authorization…',
        oauthToken: 'OAuth token',
        useToken: 'Use an OAuth token',
        tokenHint: 'You can paste a token directly, for example from Claude Code.',
        skipLater: 'You can set this later in Settings.',
        encryption: 'Encryption key',
        encryptionHint: 'Encrypts your bank credentials at rest',
        auto: 'Auto-generate',
        custom: 'Custom',
        storageHint: 'This key is stored in app settings and encrypts bank login credentials.',
        customPlaceholder: 'Enter a key with at least 8 characters',
        optional: 'Optional settings',
        optionalHint: 'You can change these anytime in Settings',
        schedule: 'Sync schedule (cron)',
        timezone: 'Timezone',
        telegram: 'Telegram bot token',
        optionalPlaceholder: 'Optional',
        back: 'Back',
        skip: 'Skip',
        next: 'Next',
        finish: 'Finish setup',
        saving: 'Saving…',
      },
);

const router = useRouter();
const isElectron = !!(window as any).electronAPI;

const step = ref(1);
const saving = ref(false);
const error = ref('');

// Step 1: AI Provider
const providers = ref<AIProvider[]>([]);
const selectedProvider = ref('anthropic');
const selectedModel = ref('');
const apiKey = ref('');
const oauthToken = ref('');

onMounted(async () => {
  try {
    const { providers: p } = await getAIProviders();
    providers.value = p;
  } catch (e) {
    console.error('Failed to load AI providers:', e);
  }
});

const currentProvider = computed(() =>
  providers.value.find((p) => p.id === selectedProvider.value),
);

// Step 2: Credentials Master Key
const masterKeyMode = ref<'auto' | 'custom'>('auto');
const customMasterKey = ref('');
const autoMasterKey = ref(generateKey());

function generateKey(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

const masterKey = computed(() =>
  masterKeyMode.value === 'auto' ? autoMasterKey.value : customMasterKey.value,
);

// Step 3: Optional settings
const scrapeCron = ref('0 6 * * *');
const scrapeTimezone = ref('Asia/Jerusalem');
const telegramBotToken = ref('');

// Anthropic OAuth
const oauthConnected = ref(false);
const { oauthStep, oauthCode, oauthError, startOAuth, submitOAuthCode, cancelOAuth } = useOAuth(
  anthropicOAuth,
  {
    onSuccess: () => {
      oauthConnected.value = true;
    },
  },
);

const canProceed = computed(() => {
  if (step.value === 1) {
    return !!(apiKey.value.trim() || oauthToken.value.trim() || oauthConnected.value);
  }
  if (step.value === 2) return masterKey.value.length >= 8;
  return true;
});

function next() {
  if (step.value < 3) step.value++;
}

function prev() {
  if (step.value > 1) step.value--;
}

async function finish() {
  saving.value = true;
  error.value = '';
  try {
    const settings: Record<string, string> = {
      CREDENTIALS_MASTER_KEY: masterKey.value,
      SCRAPE_CRON: scrapeCron.value,
      SCRAPE_TIMEZONE: scrapeTimezone.value,
      AI_PROVIDER: selectedProvider.value,
    };
    if (selectedModel.value) {
      settings.AI_CHAT_MODEL = selectedModel.value;
    }
    // Provider-specific API key
    const provider = currentProvider.value;
    if (provider && apiKey.value.trim()) {
      settings[provider.apiKeyField] = apiKey.value.trim();
    }
    if (selectedProvider.value === 'anthropic' && oauthToken.value.trim()) {
      settings.ANTHROPIC_OAUTH_TOKEN = oauthToken.value.trim();
    }
    if (telegramBotToken.value.trim()) {
      settings.TELEGRAM_BOT_TOKEN = telegramBotToken.value.trim();
    }
    await updateSettings(settings);
    router.replace('/');
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to save settings';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="setup-page" :dir="language === 'he' ? 'rtl' : 'ltr'">
    <!-- macOS drag region for Electron -->
    <div v-if="isElectron" class="fixed top-0 left-0 right-0 h-10 z-50" style="app-region: drag" />
    <div class="setup-shell">
      <!-- Header -->
      <header class="setup-header">
        <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 shrink-0">
          <Wallet class="h-5 w-5 text-primary" />
        </div>
        <div>
          <p class="text-[12px] text-text-secondary">Money Monitor</p>
          <h1 class="text-[18px] font-semibold text-text-primary">{{ copy.intro }}</h1>
        </div>
      </header>

      <!-- Progress -->
      <ol
        :aria-label="language === 'he' ? `שלב ${step} מתוך 3` : `Step ${step} of 3`"
        role="status"
        class="setup-progress"
      >
        <li
          v-for="(label, index) in [copy.provider, copy.encryption, copy.optional]"
          :key="index"
          :aria-current="step === index + 1 ? 'step' : undefined"
          :class="{ current: step === index + 1, complete: step > index + 1 }"
        >
          <span class="setup-step-number"
            ><Check v-if="step > index + 1" :size="12" /><template v-else>{{
              index + 1
            }}</template></span
          >
          <span>{{ label }}</span>
        </li>
      </ol>

      <!-- Step 1: AI Provider -->
      <Card v-if="step === 1" class="setup-step">
        <CardHeader class="p-0">
          <div class="flex items-center gap-3 [&>div:first-child]:shrink-0">
            <div class="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10">
              <MessageCircle class="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle>{{ copy.provider }}</CardTitle>
              <CardDescription>{{ copy.providerHint }}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent class="space-y-5 px-0 pt-5 pb-0">
          <!-- Provider buttons -->
          <div class="grid grid-cols-1 min-[400px]:grid-cols-2 min-[640px]:grid-cols-3 gap-2">
            <Button
              v-for="p in providers"
              :key="p.id"
              :aria-pressed="selectedProvider === p.id"
              :variant="selectedProvider === p.id ? 'default' : 'secondary'"
              class="justify-start h-auto whitespace-normal py-2 text-start"
              @click="
                selectedProvider = p.id;
                selectedModel = '';
                apiKey = '';
              "
            >
              {{ p.name }}
            </Button>
          </div>

          <div class="setup-fields">
            <!-- API Key -->
            <div class="space-y-1">
              <label
                for="setup-wizard-field-1"
                class="text-[14px] font-medium text-text-primary block"
                >{{ currentProvider?.name ?? 'API' }} {{ copy.key }}</label
              >
              <Input
                id="setup-wizard-field-1"
                v-model="apiKey"
                type="password"
                :placeholder="selectedProvider === 'anthropic' ? 'sk-ant-...' : 'sk-...'"
              />
              <p
                v-if="selectedProvider === 'opencode-go'"
                class="text-[12px] leading-relaxed text-text-secondary"
              >
                {{ copy.opencodeHint }}
                <a
                  href="https://opencode.ai/zen/go"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="underline"
                  >{{ copy.learnMore }}</a
                >
              </p>
            </div>
            <!-- Model selection -->
            <div class="space-y-1">
              <label
                for="setup-wizard-field-3"
                class="text-[14px] font-medium text-text-primary block"
                >{{ copy.model }}</label
              >
              <Select v-model="selectedModel">
                <SelectTrigger id="setup-wizard-field-3">
                  <SelectValue :placeholder="copy.selectModel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="m in currentProvider?.models ?? []" :key="m.id" :value="m.id">
                    {{ m.name }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <!-- Anthropic OAuth (alternative to API key) -->
          <template v-if="selectedProvider === 'anthropic'">
            <div class="relative flex items-center justify-center">
              <div class="absolute border-t w-full" />
              <span class="relative bg-card px-2 text-xs text-muted-foreground">{{ copy.or }}</span>
            </div>

            <div
              v-if="oauthConnected && oauthStep === 'idle'"
              class="flex items-center gap-2 text-[14px]"
            >
              <CheckCircle class="h-4 w-4 text-green-500" />
              <span class="text-text-secondary">{{ copy.connected }}</span>
            </div>

            <div v-else-if="oauthStep === 'idle'" class="space-y-1.5">
              <Button variant="secondary" size="sm" class="w-full" @click="startOAuth">
                {{ copy.login }}
              </Button>
              <p class="text-[12px] text-text-secondary">
                {{ copy.loginHint }}
              </p>
            </div>

            <div v-else-if="oauthStep === 'waiting_code'" class="space-y-2">
              <p class="text-[12px] text-text-secondary">
                {{ copy.codeHint }}
              </p>
              <div class="flex flex-wrap gap-2">
                <Input
                  v-model="oauthCode"
                  :placeholder="copy.pasteCode"
                  class="flex-1"
                  @keydown.enter="submitOAuthCode"
                />
                <Button size="sm" :disabled="!oauthCode.trim()" @click="submitOAuthCode">
                  {{ copy.submit }}
                </Button>
              </div>
              <button class="text-[12px] text-text-secondary underline" @click="cancelOAuth">
                {{ copy.cancel }}
              </button>
            </div>

            <div v-else-if="oauthStep === 'submitting'" class="text-[12px] text-text-secondary">
              {{ copy.verifying }}
            </div>

            <p v-if="oauthError" class="text-[12px] text-destructive">{{ oauthError }}</p>

            <!-- Manual OAuth token paste -->
            <details class="setup-token">
              <summary>{{ copy.useToken }}</summary>
              <div class="space-y-1 pt-3">
                <label
                  for="setup-wizard-field-2"
                  class="text-[14px] font-medium text-text-primary block"
                  >{{ copy.oauthToken }}</label
                >
                <Input
                  id="setup-wizard-field-2"
                  v-model="oauthToken"
                  type="password"
                  placeholder="oat-..."
                />
                <p class="text-[12px] text-text-secondary mt-1">
                  {{ copy.tokenHint }}
                </p>
              </div>
            </details>
          </template>

          <p class="text-[12px] text-text-secondary">
            {{ copy.skipLater }}
          </p>
        </CardContent>
      </Card>

      <!-- Step 2: Master Key -->
      <Card v-if="step === 2" class="setup-step">
        <CardHeader class="p-0">
          <div class="flex items-center gap-3 [&>div:first-child]:shrink-0">
            <div class="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10">
              <Key class="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle>{{ copy.encryption }}</CardTitle>
              <CardDescription>{{ copy.encryptionHint }}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent class="space-y-5 px-0 pt-5 pb-0">
          <div class="flex flex-wrap gap-2">
            <Button
              :variant="masterKeyMode === 'auto' ? 'default' : 'secondary'"
              size="sm"
              @click="masterKeyMode = 'auto'"
            >
              {{ copy.auto }}
            </Button>
            <Button
              :variant="masterKeyMode === 'custom' ? 'default' : 'secondary'"
              size="sm"
              @click="masterKeyMode = 'custom'"
            >
              {{ copy.custom }}
            </Button>
          </div>

          <div v-if="masterKeyMode === 'auto'">
            <div
              class="p-3 rounded-lg bg-bg-secondary border border-separator font-mono text-[12px] break-all text-text-secondary"
            >
              {{ autoMasterKey }}
            </div>
            <p class="text-[12px] text-text-secondary mt-1.5">
              {{ copy.storageHint }}
            </p>
          </div>

          <div v-else>
            <Input
              v-model="customMasterKey"
              :aria-label="language === 'he' ? 'מפתח הצפנה מותאם' : 'Custom encryption key'"
              type="text"
              :placeholder="copy.customPlaceholder"
            />
          </div>
        </CardContent>
      </Card>

      <!-- Step 3: Optional -->
      <Card v-if="step === 3" class="setup-step">
        <CardHeader class="p-0">
          <div class="flex items-center gap-3 [&>div:first-child]:shrink-0">
            <div class="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10">
              <Check class="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle>{{ copy.optional }}</CardTitle>
              <CardDescription>{{ copy.optionalHint }}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent class="space-y-5 px-0 pt-5 pb-0">
          <div>
            <label
              for="setup-wizard-field-4"
              class="text-[14px] font-medium text-text-primary block mb-1.5"
              >{{ copy.schedule }}</label
            >
            <Input id="setup-wizard-field-4" v-model="scrapeCron" placeholder="0 6 * * *" />
          </div>
          <div>
            <label
              for="setup-wizard-field-5"
              class="text-[14px] font-medium text-text-primary block mb-1.5"
              >{{ copy.timezone }}</label
            >
            <Input
              id="setup-wizard-field-5"
              v-model="scrapeTimezone"
              placeholder="Asia/Jerusalem"
            />
          </div>
          <div>
            <label
              for="setup-wizard-field-6"
              class="text-[14px] font-medium text-text-primary block mb-1.5"
              >{{ copy.telegram }}</label
            >
            <Input
              id="setup-wizard-field-6"
              v-model="telegramBotToken"
              type="password"
              :placeholder="copy.optionalPlaceholder"
            />
          </div>
        </CardContent>
      </Card>

      <!-- Error -->
      <p v-if="error" class="setup-error text-[14px] text-destructive" role="alert">{{ error }}</p>

      <!-- Navigation -->
      <div class="setup-footer flex items-center justify-between">
        <Button v-if="step > 1" variant="ghost" @click="prev">
          <ArrowLeft class="setup-back-arrow h-4 w-4 mr-1" />
          {{ copy.back }}
        </Button>
        <div v-else />

        <div class="flex flex-wrap gap-2">
          <Button
            v-if="step === 1"
            variant="ghost"
            @click="
              step = 2;
              apiKey = '';
              oauthToken = '';
              cancelOAuth();
            "
          >
            {{ copy.skip }}
          </Button>
          <Button v-if="step < 3" :disabled="step === 2 && !canProceed" @click="next">
            {{ copy.next }}
            <ArrowRight class="setup-next-arrow h-4 w-4 ml-1" />
          </Button>
          <Button v-if="step === 3" :disabled="saving" @click="finish">
            {{ saving ? copy.saving : copy.finish }}
            <Check v-if="!saving" class="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.setup-page {
  display: grid;
  place-items: center;
  height: 100dvh;
  padding: 24px 32px;
  background: var(--bg-secondary);
}
.setup-shell {
  display: flex;
  flex-direction: column;
  width: min(100%, 600px);
  max-height: calc(100dvh - 48px);
  overflow: hidden;
  border: 1px solid var(--separator);
  border-radius: 12px;
  background: var(--bg-primary);
}
.setup-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  padding: 20px 24px;
}
.setup-progress {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  flex-shrink: 0;
  margin-inline: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--separator);
}
.setup-progress li {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.4;
}
.setup-progress .current {
  color: var(--accent);
  font-weight: 600;
}
.setup-step-number {
  display: grid;
  place-items: center;
  flex: 0 0 24px;
  height: 24px;
  border: 1px solid var(--separator);
  border-radius: 50%;
  font-variant-numeric: tabular-nums;
}
.current .setup-step-number,
.complete .setup-step-number {
  border-color: transparent;
  background: var(--accent-15);
  color: var(--accent);
}
.setup-step {
  padding: 24px;
  min-height: 0;
  overflow-y: auto;
  scroll-padding-block: 24px;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
.setup-page :deep(input),
.setup-page :deep(button[role='combobox']) {
  min-height: var(--control-height);
}
.setup-page :deep(label) {
  margin-bottom: 8px;
  font-size: 12px;
}
.setup-page :deep(p) {
  line-height: 1.6;
}

.setup-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}
.setup-token summary {
  width: fit-content;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}
.setup-error {
  padding: 12px 24px;
}
.setup-footer {
  flex-shrink: 0;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--separator);
}
@media (max-width: 600px) {
  .setup-fields {
    grid-template-columns: minmax(0, 1fr);
  }
  .setup-page {
    padding: 16px;
  }
  .setup-shell {
    max-height: calc(100dvh - 32px);
  }
  .setup-header,
  .setup-step,
  .setup-footer {
    padding-inline: 20px;
  }
  .setup-progress {
    margin-inline: 20px;
    gap: 8px;
  }
}
</style>
