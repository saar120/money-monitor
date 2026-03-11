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
  TrendingUp,
  RefreshCw,
  ClipboardCheck,
  Calendar,
  Landmark,
  Save,
  CheckCircle,
  AlertCircle,
  RotateCcw,
  SendHorizonal,
} from 'lucide-vue-next';

const loading = ref(true);
const saving = ref(false);
const error = ref('');
const success = ref('');
const testSending = ref(false);

const settings = ref<AlertSettings>({
  enabled: true,
  dailyDigest: { enabled: true, largeChargeThreshold: 500, reportErrors: true },
  unusualSpending: { enabled: true, percentThreshold: 30 },
  newRecurring: { enabled: true },
  reviewReminder: { enabled: true },
  monthlySummary: { enabled: true },
  netWorthChange: { enabled: true, changeThreshold: 10000, milestoneInterval: 100000 },
});

onMounted(async () => {
  try {
    const data = await getAlertSettings();
    settings.value = data;
  } catch (e: any) {
    error.value = e.message || 'Failed to load alert settings';
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
    setTimeout(() => { success.value = ''; }, 3000);
  } catch (e: any) {
    error.value = e.message || 'Failed to save';
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
    setTimeout(() => { success.value = ''; }, 3000);
  } catch (e: any) {
    error.value = e.message || 'Failed to reset';
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
    setTimeout(() => { success.value = ''; }, 3000);
  } catch (e: any) {
    error.value = e.message || 'Failed to send test alert';
  } finally {
    testSending.value = false;
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto space-y-4 overflow-y-auto flex-1">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-[20px] font-semibold text-text-primary">Alerts</h1>
        <p class="text-[13px] text-text-secondary mt-0.5">
          Configure proactive Telegram notifications
        </p>
      </div>
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
    <div v-if="error" class="flex items-center gap-2 text-[13px] text-destructive bg-destructive/10 rounded-lg px-3 py-2">
      <AlertCircle class="h-4 w-4 flex-shrink-0" />
      {{ error }}
    </div>
    <div v-if="success" class="flex items-center gap-2 text-[13px] text-success bg-success/10 rounded-lg px-3 py-2">
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
                <div class="text-[12px] text-text-secondary">Master switch for all Telegram notifications</div>
              </div>
            </div>
            <Switch v-model:checked="settings.enabled" />
          </div>
        </CardContent>
      </Card>

      <!-- Daily Digest -->
      <Card :class="{ 'opacity-50 pointer-events-none': !settings.enabled }">
        <CardHeader class="pb-2">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <BarChart3 class="h-4 w-4 text-text-secondary" />
              <CardTitle class="text-[14px]">Post-Scrape Digest</CardTitle>
            </div>
            <Switch v-model:checked="settings.dailyDigest.enabled" />
          </div>
          <CardDescription class="text-[12px]">
            Summary of new transactions after each scrape
          </CardDescription>
        </CardHeader>
        <CardContent v-if="settings.dailyDigest.enabled" class="space-y-3">
          <div class="flex items-center justify-between">
            <label class="text-[13px] text-text-primary">Large charge threshold (₪)</label>
            <Input
              type="number"
              class="w-24 h-8 text-[13px]"
              v-model.number="settings.dailyDigest.largeChargeThreshold"
              min="0"
            />
          </div>
          <div class="flex items-center justify-between">
            <label class="text-[13px] text-text-primary">Report scrape errors</label>
            <Switch v-model:checked="settings.dailyDigest.reportErrors" />
          </div>
        </CardContent>
      </Card>

      <!-- Unusual Spending -->
      <Card :class="{ 'opacity-50 pointer-events-none': !settings.enabled }">
        <CardHeader class="pb-2">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <TrendingUp class="h-4 w-4 text-text-secondary" />
              <CardTitle class="text-[14px]">Unusual Spending</CardTitle>
            </div>
            <Switch v-model:checked="settings.unusualSpending.enabled" />
          </div>
          <CardDescription class="text-[12px]">
            Alert when spending in a category exceeds its usual level
          </CardDescription>
        </CardHeader>
        <CardContent v-if="settings.unusualSpending.enabled" class="space-y-3">
          <div class="flex items-center justify-between">
            <label class="text-[13px] text-text-primary">Spike threshold (%)</label>
            <Input
              type="number"
              class="w-24 h-8 text-[13px]"
              v-model.number="settings.unusualSpending.percentThreshold"
              min="10"
              max="200"
            />
          </div>
        </CardContent>
      </Card>

      <!-- New Recurring -->
      <Card :class="{ 'opacity-50 pointer-events-none': !settings.enabled }">
        <CardHeader class="pb-0">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <RefreshCw class="h-4 w-4 text-text-secondary" />
              <CardTitle class="text-[14px]">New Recurring Charges</CardTitle>
            </div>
            <Switch v-model:checked="settings.newRecurring.enabled" />
          </div>
          <CardDescription class="text-[12px]">
            Detect and notify about newly identified subscriptions and recurring bills
          </CardDescription>
        </CardHeader>
      </Card>

      <!-- Review Reminder -->
      <Card :class="{ 'opacity-50 pointer-events-none': !settings.enabled }">
        <CardHeader class="pb-0">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <ClipboardCheck class="h-4 w-4 text-text-secondary" />
              <CardTitle class="text-[14px]">Review Reminders</CardTitle>
            </div>
            <Switch v-model:checked="settings.reviewReminder.enabled" />
          </div>
          <CardDescription class="text-[12px]">
            Remind when transactions need manual review (low-confidence categorization)
          </CardDescription>
        </CardHeader>
      </Card>

      <!-- Monthly Summary -->
      <Card :class="{ 'opacity-50 pointer-events-none': !settings.enabled }">
        <CardHeader class="pb-0">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Calendar class="h-4 w-4 text-text-secondary" />
              <CardTitle class="text-[14px]">Monthly Summary</CardTitle>
            </div>
            <Switch v-model:checked="settings.monthlySummary.enabled" />
          </div>
          <CardDescription class="text-[12px]">
            Income vs spending, top categories, and month-over-month comparison (sent on the 1st)
          </CardDescription>
        </CardHeader>
      </Card>

      <!-- Net Worth -->
      <Card :class="{ 'opacity-50 pointer-events-none': !settings.enabled }">
        <CardHeader class="pb-2">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Landmark class="h-4 w-4 text-text-secondary" />
              <CardTitle class="text-[14px]">Net Worth Changes</CardTitle>
            </div>
            <Switch v-model:checked="settings.netWorthChange.enabled" />
          </div>
          <CardDescription class="text-[12px]">
            Alert on significant net worth changes and milestone crossings
          </CardDescription>
        </CardHeader>
        <CardContent v-if="settings.netWorthChange.enabled" class="space-y-3">
          <div class="flex items-center justify-between">
            <label class="text-[13px] text-text-primary">Change threshold (₪)</label>
            <Input
              type="number"
              class="w-28 h-8 text-[13px]"
              v-model.number="settings.netWorthChange.changeThreshold"
              min="1000"
            />
          </div>
          <div class="flex items-center justify-between">
            <label class="text-[13px] text-text-primary">Milestone interval (₪)</label>
            <Input
              type="number"
              class="w-28 h-8 text-[13px]"
              v-model.number="settings.netWorthChange.milestoneInterval"
              min="10000"
            />
          </div>
        </CardContent>
      </Card>
    </template>

    <!-- Loading skeleton -->
    <template v-else>
      <div v-for="i in 4" :key="i" class="h-24 bg-bg-secondary animate-pulse rounded-xl" />
    </template>
  </div>
</template>
