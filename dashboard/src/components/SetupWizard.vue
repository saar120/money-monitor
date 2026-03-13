<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { updateSettings, getAIProviders, type AIProvider } from '../api/client';
import { useAnthropicOAuth } from '../composables/useAnthropicOAuth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Wallet, ArrowRight, ArrowLeft, Key, Bot, Check, CheckCircle } from 'lucide-vue-next';

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
  providers.value.find(p => p.id === selectedProvider.value)
);

// Step 2: Credentials Master Key
const masterKeyMode = ref<'auto' | 'custom'>('auto');
const customMasterKey = ref('');
const autoMasterKey = ref(generateKey());

function generateKey(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

const masterKey = computed(() =>
  masterKeyMode.value === 'auto' ? autoMasterKey.value : customMasterKey.value
);

// Step 3: Optional settings
const scrapeCron = ref('0 6 * * *');
const scrapeTimezone = ref('Asia/Jerusalem');
const telegramBotToken = ref('');

// Anthropic OAuth
const oauthConnected = ref(false);
const { oauthStep, oauthCode, oauthError, startOAuth, submitOAuthCode, cancelOAuth } = useAnthropicOAuth({
  onSuccess: () => { oauthConnected.value = true; },
});

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
  <div class="min-h-screen bg-bg-secondary flex items-center justify-center p-8" style="background-image: radial-gradient(ellipse at 50% 0%, var(--accent-15), transparent 70%)">
    <!-- macOS drag region for Electron -->
    <div v-if="isElectron" class="fixed top-0 left-0 right-0 h-10 z-50" style="app-region: drag" />
    <div class="w-full max-w-lg">
      <!-- Header -->
      <div class="text-center mb-8">
        <div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-4">
          <Wallet class="h-7 w-7 text-primary" />
        </div>
        <h1 class="text-[22px] font-semibold text-text-primary">Money Monitor</h1>
        <p class="text-text-secondary mt-1">Let's set up your desktop app</p>
      </div>

      <!-- Progress -->
      <div class="flex items-center justify-center gap-2 mb-8">
        <div
          v-for="s in 3" :key="s"
          class="h-2 w-2 rounded-full transition-all duration-200"
          :class="[s <= step ? 'bg-primary' : 'bg-bg-tertiary', s === step ? 'scale-110' : '']"
        />
      </div>

      <!-- Step 1: AI Provider -->
      <Card v-if="step === 1">
        <CardHeader>
          <div class="flex items-center gap-3">
            <div class="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10">
              <Bot class="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle>AI Provider</CardTitle>
              <CardDescription>Choose your AI provider and enter your API key</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent class="space-y-4">
          <!-- Provider buttons -->
          <div class="grid grid-cols-2 gap-2">
            <Button
              v-for="p in providers"
              :key="p.id"
              :variant="selectedProvider === p.id ? 'default' : 'outline'"
              @click="selectedProvider = p.id; selectedModel = ''; apiKey = ''"
              class="justify-start"
            >
              {{ p.name }}
            </Button>
          </div>

          <!-- API Key -->
          <div class="space-y-1">
            <label class="text-[13px] font-medium text-text-primary block">{{ currentProvider?.name ?? 'API' }} Key</label>
            <Input
              type="password"
              v-model="apiKey"
              :placeholder="selectedProvider === 'anthropic' ? 'sk-ant-...' : 'sk-...'"
            />
          </div>

          <!-- Anthropic OAuth (alternative to API key) -->
          <template v-if="selectedProvider === 'anthropic'">
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
              <Input type="password" v-model="oauthToken" placeholder="oat-..." />
              <p class="text-[11px] text-text-secondary mt-1">Paste an OAuth token directly (e.g. from Claude Code CLI)</p>
            </div>
          </template>

          <!-- Model selection -->
          <div class="space-y-1">
            <label class="text-[13px] font-medium text-text-primary block">Model</label>
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

          <p class="text-[11px] text-text-secondary">
            You can skip this and set it later in Settings.
          </p>
        </CardContent>
      </Card>

      <!-- Step 2: Master Key -->
      <Card v-if="step === 2">
        <CardHeader>
          <div class="flex items-center gap-3">
            <div class="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10">
              <Key class="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle>Encryption Key</CardTitle>
              <CardDescription>Used to encrypt your bank credentials at rest</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="flex gap-2">
            <Button
              :variant="masterKeyMode === 'auto' ? 'default' : 'outline'"
              size="sm"
              @click="masterKeyMode = 'auto'"
            >
              Auto-generate
            </Button>
            <Button
              :variant="masterKeyMode === 'custom' ? 'default' : 'outline'"
              size="sm"
              @click="masterKeyMode = 'custom'"
            >
              Custom
            </Button>
          </div>

          <div v-if="masterKeyMode === 'auto'">
            <div class="p-3 rounded-lg bg-bg-secondary border border-separator font-mono text-[11px] break-all text-text-secondary">
              {{ autoMasterKey }}
            </div>
            <p class="text-[11px] text-text-secondary mt-1.5">
              This key is stored in your app config and encrypts bank login credentials.
            </p>
          </div>

          <div v-else>
            <Input
              v-model="customMasterKey"
              type="text"
              placeholder="Enter a key (min 8 characters)"
            />
          </div>
        </CardContent>
      </Card>

      <!-- Step 3: Optional -->
      <Card v-if="step === 3">
        <CardHeader>
          <div class="flex items-center gap-3">
            <div class="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10">
              <Check class="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle>Optional Settings</CardTitle>
              <CardDescription>You can change these anytime in Settings</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent class="space-y-4">
          <div>
            <label class="text-[13px] font-medium text-text-primary block mb-1.5">Scrape Schedule (cron)</label>
            <Input v-model="scrapeCron" placeholder="0 6 * * *" />
          </div>
          <div>
            <label class="text-[13px] font-medium text-text-primary block mb-1.5">Timezone</label>
            <Input v-model="scrapeTimezone" placeholder="Asia/Jerusalem" />
          </div>
          <div>
            <label class="text-[13px] font-medium text-text-primary block mb-1.5">Telegram Bot Token</label>
            <Input v-model="telegramBotToken" type="password" placeholder="Optional" />
          </div>
        </CardContent>
      </Card>

      <!-- Error -->
      <p v-if="error" class="text-[13px] text-destructive mt-3">{{ error }}</p>

      <!-- Navigation -->
      <div class="flex items-center justify-between mt-6">
        <Button
          v-if="step > 1"
          variant="ghost"
          @click="prev"
        >
          <ArrowLeft class="h-4 w-4 mr-1" />
          Back
        </Button>
        <div v-else />

        <div class="flex gap-2">
          <Button
            v-if="step === 1"
            variant="ghost"
            @click="step = 2; apiKey = ''; oauthToken = ''; cancelOAuth()"
          >
            Skip
          </Button>
          <Button
            v-if="step < 3"
            :disabled="step === 2 && !canProceed"
            @click="next"
          >
            Next
            <ArrowRight class="h-4 w-4 ml-1" />
          </Button>
          <Button
            v-if="step === 3"
            :disabled="saving"
            @click="finish"
          >
            {{ saving ? 'Saving...' : 'Finish Setup' }}
            <Check v-if="!saving" class="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
