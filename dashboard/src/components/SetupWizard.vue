<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { useRouter } from 'vue-router';
import { getSettings, updateSettings } from '../api/client';
import { Button } from '@/components/ui/button';
import SelectField from '@/components/ui/select/SelectField.vue';
import { Wallet, Check } from 'lucide-vue-next';
import {
  language,
  languageChoice,
  setLanguageChoice,
  t,
  type LanguageChoice,
} from '@/lib/language';

const router = useRouter();
const isElectron = !!(window as unknown as { electronAPI?: unknown }).electronAPI;
const step = ref(1);
const stepContent = ref<HTMLElement | null>(null);
async function goToStep(value: number) {
  step.value = value;
  await nextTick();
  stepContent.value?.focus();
}
const saving = ref(false);
const error = ref('');
const copy = computed(() =>
  language.value === 'he'
    ? {
        title: 'ברוכים הבאים ל־Money Monitor',
        welcome: 'מתחילים',
        accounts: 'חיבור חשבון',
        intro: 'החשבונות, ההוצאות והתמונה הכלכלית שלכם במקום אחד.',
        privacy: 'הנתונים נשמרים במחשב שלכם. פרטי הכניסה לבנקים מוצפנים אוטומטית.',
        next: 'המשך',
        back: 'חזרה',
        connect: 'הוספת חשבון ראשון',
        explore: 'אחבר חשבון בהמשך',
        heading: 'נתחיל מחשבון אחד',
        detail:
          'בחרו בנק או חברת אשראי והתחברו. לאחר רענון החשבון תוכלו לראות את התנועות ולעקוב אחר ההוצאות.',
        optional:
          'בינה מלאכותית היא אפשרות לבחירתכם. אפשר לחבר את היועץ ולהגדיר גישה מהטלפון בהמשך בהגדרות.',
        saving: 'שומר את ההגדרות…',
        failed: 'לא ניתן להשלים את ההגדרה. נסו שוב.',
      }
    : {
        title: 'Welcome to Money Monitor',
        welcome: 'Get started',
        accounts: 'Connect an account',
        intro: 'Your accounts, spending, and financial picture in one place.',
        privacy:
          'Your data stays on this computer. Bank sign-in details are encrypted automatically.',
        next: 'Continue',
        back: 'Back',
        connect: 'Add your first account',
        explore: 'I’ll do this later',
        heading: 'Start with one account',
        detail:
          'Choose your bank or credit card company and sign in. Once your account refreshes, you can see your transactions and start tracking spending.',
        optional:
          'AI is optional. Connect the Advisor and set up iPhone access whenever you’re ready in Settings.',
        saving: 'Saving your setup…',
        failed: 'Setup could not be completed. Please try again.',
      },
);

async function finish(destination: string) {
  if (saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    // Security is prepared by the desktop app; finishing only records this choice.
    const current = await getSettings();
    if (current.isElectron) {
      await updateSettings({ ONBOARDING_COMPLETED: 'true', APP_LANGUAGE: languageChoice.value });
    }
    await router.replace(destination);
  } catch {
    error.value = copy.value.failed;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="setup-page" :dir="language === 'he' ? 'rtl' : 'ltr'">
    <div v-if="isElectron" class="fixed top-0 left-0 right-0 h-10 z-50" style="app-region: drag" />
    <div class="setup-shell">
      <header class="setup-header">
        <Wallet class="h-6 w-6 text-primary shrink-0" />
        <h1 class="text-[18px] font-semibold">{{ copy.title }}</h1>
      </header>
      <ol
        class="setup-progress"
        :aria-label="language === 'he' ? `שלב ${step} מתוך 2` : `Step ${step} of 2`"
      >
        <li
          v-for="(label, index) in [copy.welcome, copy.accounts]"
          :key="label"
          :class="{ current: step === index + 1, complete: step > index + 1 }"
          :aria-current="step === index + 1 ? 'step' : undefined"
        >
          <span class="setup-step-number"
            ><Check v-if="step > index + 1" :size="12" /><template v-else>{{
              index + 1
            }}</template></span
          >{{ label }}
        </li>
      </ol>
      <section v-if="step === 1" ref="stepContent" tabindex="-1" class="setup-step space-y-5">
        <p class="text-[18px] text-text-primary">{{ copy.intro }}</p>
        <p class="text-text-secondary">{{ copy.privacy }}</p>
        <div class="space-y-2">
          <label for="onboarding-language">{{ t('appLanguage') }}</label>
          <SelectField
            id="onboarding-language"
            :model-value="languageChoice"
            :aria-label="t('appLanguage')"
            :options="[
              { value: 'system', label: t('systemDefault') },
              { value: 'en', label: t('english') },
              { value: 'he', label: t('hebrew') },
            ]"
            @update:model-value="setLanguageChoice($event as LanguageChoice)"
          />
        </div>
      </section>
      <section v-else ref="stepContent" tabindex="-1" class="setup-step space-y-5">
        <h2 class="text-[18px] font-semibold">{{ copy.heading }}</h2>
        <p class="text-text-primary">{{ copy.detail }}</p>
        <p class="text-text-secondary">{{ copy.optional }}</p>
      </section>
      <p v-if="error" class="setup-error text-destructive" role="alert">{{ error }}</p>
      <div class="setup-footer flex flex-wrap items-center justify-between">
        <Button v-if="step === 2" variant="ghost" :disabled="saving" @click="goToStep(1)">{{
          copy.back
        }}</Button>
        <span v-else />
        <Button v-if="step === 1" @click="goToStep(2)">{{ copy.next }}</Button>
        <template v-else>
          <Button variant="ghost" :disabled="saving" @click="finish('/')">{{
            copy.explore
          }}</Button>
          <Button :disabled="saving" @click="finish('/accounts?add=1')">{{
            saving ? copy.saving : copy.connect
          }}</Button>
        </template>
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
  grid-template-columns: repeat(2, minmax(0, 1fr));
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
