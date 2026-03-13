<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  getAlertSettings,
  updateAlertSettings,
  resetAlertSettings,
  sendTestAlert,
  type AlertSettings,
} from '../api/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Bell,
  BarChart3,
  Calendar,
  Save,
  CheckCircle,
  AlertCircle,
  RotateCcw,
  SendHorizonal,
  Info,
  Sparkles,
} from 'lucide-vue-next';
const ALERT_HINTS = {
  postScrape:
    'Runs after each scrape. An AI agent analyzes new transactions and spending patterns, alerting only when something noteworthy is found.',
  monthlySummary:
    "Sent once a month at 9:00 AM on your configured day. An AI agent summarizes last month's finances with contextual insights.",
} as const;

const loading = ref(true);
const saving = ref(false);
const error = ref('');
const success = ref('');
const testSending = ref(false);

const settings = ref<AlertSettings>({
  enabled: true,
  largeChargeThreshold: 500,
  unusualSpendingPercent: 30,
  monthlySummary: { enabled: true, dayOfMonth: 1 },
  reportScrapeErrors: true,
});

onMounted(async () => {
  try {
    const data = await getAlertSettings();
    settings.value = data;
  } catch (e: unknown) {
    error.value = (e instanceof Error ? e.message : '') || 'Failed to load alert settings';
  } finally {
    loading.value = false;
  }
});

async function save() {
  saving.value = true;
  error.value = '';
  success.value = '';
  try {
    const data = await updateAlertSettings(settings.value);
    settings.value = data;
    success.value = 'Settings saved';
    setTimeout(() => {
      success.value = '';
    }, 3000);
  } catch (e: unknown) {
    error.value = (e instanceof Error ? e.message : '') || 'Failed to save';
  } finally {
    saving.value = false;
  }
}

async function reset() {
  saving.value = true;
  error.value = '';
  try {
    const data = await resetAlertSettings();
    settings.value = data;
    success.value = 'Reset to defaults';
    setTimeout(() => {
      success.value = '';
    }, 3000);
  } catch (e: unknown) {
    error.value = (e instanceof Error ? e.message : '') || 'Failed to reset';
  } finally {
    saving.value = false;
  }
}

async function testAlert() {
  testSending.value = true;
  error.value = '';
  try {
    await sendTestAlert();
    success.value = 'Test alert sent to Telegram';
    setTimeout(() => {
      success.value = '';
    }, 3000);
  } catch (e: unknown) {
    error.value = (e instanceof Error ? e.message : '') || 'Failed to send test alert';
  } finally {
    testSending.value = false;
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto space-y-5 overflow-y-auto flex-1">
    <div class="flex items-center justify-between">
      <p class="text-[13px] text-text-secondary">
        AI-powered Telegram notifications about your finances
      </p>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" :disabled="saving" @click="reset">
          <RotateCcw class="h-3.5 w-3.5 mr-1.5" />
          Reset
        </Button>
        <Button variant="outline" size="sm" :disabled="testSending" @click="testAlert">
          <SendHorizonal class="h-3.5 w-3.5 mr-1.5" />
          {{ testSending ? 'Sending…' : 'Test' }}
        </Button>
        <Button size="sm" :disabled="saving" @click="save">
          <Save class="h-3.5 w-3.5 mr-1.5" />
          {{ saving ? 'Saving…' : 'Save' }}
        </Button>
      </div>
    </div>

    <!-- Status messages -->
    <div
      v-if="error"
      class="flex items-center gap-2 text-[13px] text-destructive bg-destructive/10 rounded-lg px-3 py-2"
    >
      <AlertCircle class="h-4 w-4 flex-shrink-0" />
      {{ error }}
    </div>
    <div
      v-if="success"
      class="flex items-center gap-2 text-[13px] text-success bg-success/10 rounded-lg px-3 py-2"
    >
      <CheckCircle class="h-4 w-4 flex-shrink-0" />
      {{ success }}
    </div>

    <template v-if="!loading">
      <!-- Master Switch -->
      <Card>
        <CardContent class="pt-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <Bell class="h-5 w-5 text-primary" />
              <div>
                <div class="text-[14px] font-medium text-text-primary">Enable Alerts</div>
                <div class="text-[12px] text-text-secondary">
                  Master switch for all Telegram notifications
                </div>
              </div>
            </div>
            <Switch v-model="settings.enabled" />
          </div>
        </CardContent>
      </Card>

      <!-- AI approach description -->
      <div
        :class="{ 'opacity-50 pointer-events-none': !settings.enabled }"
        class="flex items-start gap-2.5 text-[12px] text-text-secondary bg-primary/8 border border-primary/15 rounded-lg px-3 py-2.5"
      >
        <Sparkles class="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
        <span>
          Alerts are generated by an AI agent that autonomously investigates your financial data —
          transactions, spending patterns, balances, and net worth. It only sends a message when
          something genuinely noteworthy is found. The thresholds below guide the agent's analysis.
        </span>
      </div>

      <!-- Post-Scrape Analysis -->
      <Card :class="{ 'opacity-50 pointer-events-none': !settings.enabled }">
        <CardHeader class="pb-2">
          <div class="flex items-center gap-2">
            <BarChart3 class="h-4 w-4 text-text-secondary" />
            <CardTitle class="text-[14px]">Post-Scrape Analysis</CardTitle>
          </div>
          <CardDescription class="text-[12px]">
            After each scrape, the agent reviews new transactions and spending patterns
          </CardDescription>
          <p class="flex items-start gap-1.5 text-[11px] text-text-tertiary mt-1">
            <Info class="h-3 w-3 mt-0.5 flex-shrink-0" />
            {{ ALERT_HINTS.postScrape }}
          </p>
        </CardHeader>
        <CardContent class="space-y-3">
          <div class="flex items-center justify-between">
            <label class="text-[13px] text-text-primary">Large charge threshold (₪)</label>
            <Input
              v-model.number="settings.largeChargeThreshold"
              type="number"
              class="w-28 h-8 text-[13px]"
              min="0"
            />
          </div>
          <div class="flex items-center justify-between">
            <label class="text-[13px] text-text-primary">Unusual spending threshold (%)</label>
            <Input
              v-model.number="settings.unusualSpendingPercent"
              type="number"
              class="w-28 h-8 text-[13px]"
              min="10"
              max="200"
            />
          </div>
          <div class="flex items-center justify-between">
            <label class="text-[13px] text-text-primary">Report scrape errors</label>
            <Switch v-model="settings.reportScrapeErrors" />
          </div>
        </CardContent>
      </Card>

      <!-- Monthly Summary -->
      <Card :class="{ 'opacity-50 pointer-events-none': !settings.enabled }">
        <CardHeader class="pb-2">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Calendar class="h-4 w-4 text-text-secondary" />
              <CardTitle class="text-[14px]">Monthly Summary</CardTitle>
            </div>
            <Switch v-model="settings.monthlySummary.enabled" />
          </div>
          <CardDescription class="text-[12px]">
            A comprehensive AI-generated review of last month's finances
          </CardDescription>
          <p class="flex items-start gap-1.5 text-[11px] text-text-tertiary mt-1">
            <Info class="h-3 w-3 mt-0.5 flex-shrink-0" />
            {{ ALERT_HINTS.monthlySummary }}
          </p>
        </CardHeader>
        <CardContent v-if="settings.monthlySummary.enabled" class="space-y-3">
          <div class="flex items-center justify-between">
            <label class="text-[13px] text-text-primary">Day of month to send</label>
            <Input
              v-model.number="settings.monthlySummary.dayOfMonth"
              type="number"
              class="w-28 h-8 text-[13px]"
              min="1"
              max="28"
            />
          </div>
        </CardContent>
      </Card>
    </template>

    <!-- Loading skeleton -->
    <template v-else>
      <div v-for="i in 3" :key="i" class="h-24 bg-bg-secondary animate-pulse rounded-xl" />
    </template>
  </div>
</template>
