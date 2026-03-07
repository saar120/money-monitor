<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { updateSettings } from '../api/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Wallet, ArrowRight, ArrowLeft, Key, Bot, Check } from 'lucide-vue-next';

const router = useRouter();
const isElectron = !!(window as any).electronAPI;

const step = ref(1);
const saving = ref(false);
const error = ref('');

// Step 1: AI Authentication
const authMethod = ref<'api_key' | 'oauth'>('api_key');
const anthropicApiKey = ref('');
const claudeOauthToken = ref('');

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

const canProceed = computed(() => {
  if (step.value === 1) {
    if (authMethod.value === 'api_key') return anthropicApiKey.value.trim().length > 0;
    return claudeOauthToken.value.trim().length > 0;
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
    };
    if (authMethod.value === 'api_key' && anthropicApiKey.value.trim()) {
      settings.ANTHROPIC_API_KEY = anthropicApiKey.value.trim();
    }
    if (authMethod.value === 'oauth' && claudeOauthToken.value.trim()) {
      settings.CLAUDE_CODE_OAUTH_TOKEN = claudeOauthToken.value.trim();
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
  <div class="min-h-screen bg-background flex items-center justify-center p-8">
    <!-- macOS drag region for Electron -->
    <div v-if="isElectron" class="fixed top-0 left-0 right-0 h-10 z-50" style="app-region: drag" />
    <div class="w-full max-w-lg">
      <!-- Header -->
      <div class="text-center mb-8">
        <div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/20 mb-4">
          <Wallet class="h-7 w-7 text-primary" />
        </div>
        <h1 class="text-2xl font-bold heading-font text-foreground">Money Monitor</h1>
        <p class="text-muted-foreground mt-1">Let's set up your desktop app</p>
      </div>

      <!-- Progress -->
      <div class="flex items-center justify-center gap-2 mb-8">
        <div
          v-for="s in 3" :key="s"
          class="h-1.5 w-12 rounded-full transition-colors duration-200"
          :class="s <= step ? 'bg-primary' : 'bg-surface-3'"
        />
      </div>

      <!-- Step 1: AI Authentication -->
      <Card v-if="step === 1">
        <CardHeader>
          <div class="flex items-center gap-3">
            <div class="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10">
              <Bot class="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle>AI Authentication</CardTitle>
              <CardDescription>Required for AI features like chat and categorization</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="flex gap-2">
            <Button
              :variant="authMethod === 'api_key' ? 'default' : 'outline'"
              size="sm"
              @click="authMethod = 'api_key'"
            >
              API Key
            </Button>
            <Button
              :variant="authMethod === 'oauth' ? 'default' : 'outline'"
              size="sm"
              @click="authMethod = 'oauth'"
            >
              OAuth Token
            </Button>
          </div>

          <div v-if="authMethod === 'api_key'">
            <label class="text-sm font-medium text-foreground block mb-1.5">Anthropic API Key</label>
            <Input
              v-model="anthropicApiKey"
              type="password"
              placeholder="sk-ant-..."
            />
            <p class="text-xs text-muted-foreground mt-1.5">
              Get your key from console.anthropic.com
            </p>
          </div>

          <div v-else>
            <label class="text-sm font-medium text-foreground block mb-1.5">Claude Code OAuth Token</label>
            <Input
              v-model="claudeOauthToken"
              type="password"
              placeholder="oat-..."
            />
            <p class="text-xs text-muted-foreground mt-1.5">
              Use the OAuth token from Claude Code CLI
            </p>
          </div>

          <p class="text-xs text-muted-foreground">
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
            <div class="p-3 rounded-lg bg-surface-1 border border-border font-mono text-xs break-all text-muted-foreground">
              {{ autoMasterKey }}
            </div>
            <p class="text-xs text-muted-foreground mt-1.5">
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
            <label class="text-sm font-medium text-foreground block mb-1.5">Scrape Schedule (cron)</label>
            <Input v-model="scrapeCron" placeholder="0 6 * * *" />
          </div>
          <div>
            <label class="text-sm font-medium text-foreground block mb-1.5">Timezone</label>
            <Input v-model="scrapeTimezone" placeholder="Asia/Jerusalem" />
          </div>
          <div>
            <label class="text-sm font-medium text-foreground block mb-1.5">Telegram Bot Token</label>
            <Input v-model="telegramBotToken" type="password" placeholder="Optional" />
          </div>
        </CardContent>
      </Card>

      <!-- Error -->
      <p v-if="error" class="text-sm text-destructive mt-3">{{ error }}</p>

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
            @click="step = 2; anthropicApiKey = ''; claudeOauthToken = ''"
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
