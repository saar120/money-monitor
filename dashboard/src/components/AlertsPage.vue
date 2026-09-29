<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import {
  getAlertSettings,
  updateAlertSettings,
  resetAlertSettings,
  sendTestAlert,
  type AlertSettings,
} from '../api/client';
import { SettingsGroup, SettingsRow } from '@/components/ui/settings-group';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { CheckCircle, AlertCircle, RotateCcw, SendHorizonal } from 'lucide-vue-next';
import { language } from '@/lib/language';
const copy = computed(() =>
  language.value === 'he'
    ? {
        reset: 'איפוס',
        test: 'בדיקה',
        sending: 'שולח…',
        save: 'שמירה',
        saving: 'שומר…',
        saved: 'ההגדרות נשמרו',
        resetDone: 'ברירות המחדל שוחזרו',
        sent: 'התראת בדיקה נשלחה לטלגרם',
        enabled: 'התראות פעילות',
        enabledHint: 'התראות לטלגרם על פעילות שדורשת תשומת לב',
        activity: 'אחרי סנכרון',
        activityHint: 'בדיקה של עסקאות חדשות ושינויים חריגים',
        largeCharge: 'סכום חיוב גדול (₪)',
        unusual: 'שינוי חריג בהוצאות (%)',
        errors: 'שגיאות סנכרון',
        monthly: 'סיכום חודשי',
        monthlyHint: 'סקירה של החודש הקודם',
        monthlyEnabled: 'שליחת סיכום',
        day: 'יום בחודש',
      }
    : {
        reset: 'Reset',
        test: 'Send test',
        sending: 'Sending…',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Settings saved',
        resetDone: 'Defaults restored',
        sent: 'Test alert sent to Telegram',
        enabled: 'Alerts enabled',
        enabledHint: 'Telegram notifications for activity that needs attention',
        activity: 'After sync',
        activityHint: 'Review new transactions and unusual changes',
        largeCharge: 'Large charge (₪)',
        unusual: 'Unusual spending change (%)',
        errors: 'Sync errors',
        monthly: 'Monthly summary',
        monthlyHint: 'A review of the previous month',
        monthlyEnabled: 'Send summary',
        day: 'Day of month',
      },
);

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
    success.value = copy.value.saved;
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
    success.value = copy.value.resetDone;
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
    success.value = copy.value.sent;
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
  <div class="alerts-page max-w-2xl mx-auto space-y-7 overflow-y-auto flex-1">
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
        <Button variant="secondary" size="sm" :disabled="saving" @click="reset">
          <RotateCcw class="h-3 w-3 mr-1.5" />
          {{ copy.reset }}
        </Button>
        <Button variant="secondary" size="sm" :disabled="testSending" @click="testAlert">
          <SendHorizonal class="h-3 w-3 mr-1.5" />
          {{ testSending ? copy.sending : copy.test }}
        </Button>
        <Button size="sm" :disabled="saving" @click="save">
          {{ saving ? copy.saving : copy.save }}
        </Button>
      </div>
    </Teleport>

    <template v-if="!loading">
      <SettingsGroup>
        <SettingsRow :label="copy.enabled" :description="copy.enabledHint">
          <Switch v-model="settings.enabled" />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        :title="copy.activity"
        :description="copy.activityHint"
        :class="{ 'opacity-50 pointer-events-none': !settings.enabled }"
      >
        <SettingsRow :label="copy.largeCharge">
          <Input
            v-model.number="settings.largeChargeThreshold"
            type="number"
            class="w-28 h-8 text-[13px]"
            min="0"
          />
        </SettingsRow>
        <SettingsRow :label="copy.unusual">
          <Input
            v-model.number="settings.unusualSpendingPercent"
            type="number"
            class="w-28 h-8 text-[13px]"
            min="10"
            max="200"
          />
        </SettingsRow>
        <SettingsRow :label="copy.errors">
          <Switch v-model="settings.reportScrapeErrors" />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        :title="copy.monthly"
        :description="copy.monthlyHint"
        :class="{ 'opacity-50 pointer-events-none': !settings.enabled }"
      >
        <SettingsRow :label="copy.monthlyEnabled">
          <Switch v-model="settings.monthlySummary.enabled" />
        </SettingsRow>
        <SettingsRow v-if="settings.monthlySummary.enabled" :label="copy.day">
          <Input
            v-model.number="settings.monthlySummary.dayOfMonth"
            type="number"
            class="w-28 h-8 text-[13px]"
            min="1"
            max="28"
          />
        </SettingsRow>
      </SettingsGroup>
    </template>

    <!-- Loading skeleton -->
    <template v-else>
      <div v-for="i in 3" :key="i" class="h-24 bg-bg-secondary animate-pulse rounded-xl" />
    </template>
  </div>
</template>
