<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue';
import { createAccount, updateAccount, getMembers, type Account, type Member } from '@/api/client';
import { PROVIDERS } from '@/lib/providers';
import { language, t } from '@/lib/language';
import { useOtpFlow } from '@/composables/useOtpFlow';
import { useSseConnection } from '@/composables/useSseConnection';
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Loader2, Plus } from 'lucide-vue-next';
const emit = defineEmits<{ changed: [] }>();
const members = ref<Member[]>([]);
const activeMembers = computed(() => members.value.filter((member) => member.isActive));
const showAddDialog = ref(false);
const newCompanyId = ref('');
const newDisplayName = ref('');
const newMemberId = ref('');
const credentialValues = ref<Record<string, string>>({});
const credentialFields = ref<Array<{ key: string; value: string }>>([{ key: '', value: '' }]);
const selectedProvider = computed(() => PROVIDERS.find((p) => p.id === newCompanyId.value));
const updateCredsAccount = ref<Account | null>(null);
const showUpdateCredsDialog = ref(false);
const updateCredsValues = ref<Record<string, string>>({});
const updateCredsFields = ref<Array<{ key: string; value: string }>>([{ key: '', value: '' }]);
const updateCredsSaving = ref(false);
const adding = ref(false);
const error = ref('');
const credentialsChanged = computed(
  () =>
    Object.values(updateCredsValues.value).some(Boolean) ||
    updateCredsFields.value.some((field) => field.key && field.value),
);
const updateCredsProvider = computed(() =>
  PROVIDERS.find((p) => p.id === updateCredsAccount.value?.companyId),
);
watch(newCompanyId, () => {
  credentialValues.value = {};
  credentialFields.value = [{ key: '', value: '' }];
});
function openAdd() {
  error.value = '';
  showAddDialog.value = true;
}
function openUpdateCreds(account: Account) {
  error.value = '';
  updateCredsAccount.value = account;
  updateCredsValues.value = {};
  updateCredsFields.value = [{ key: '', value: '' }];
  showUpdateCredsDialog.value = true;
}
function addCredentialField() {
  credentialFields.value.push({ key: '', value: '' });
}
function addUpdateCredField() {
  updateCredsFields.value.push({ key: '', value: '' });
}
async function handleAdd() {
  if (adding.value) return;
  adding.value = true;
  error.value = '';
  try {
    const credentials = selectedProvider.value?.fields.length
      ? credentialValues.value
      : Object.fromEntries(
          credentialFields.value.filter((f) => f.key).map((f) => [f.key, f.value]),
        );
    await createAccount({
      companyId: newCompanyId.value,
      displayName: newDisplayName.value.trim(),
      memberId: Number(newMemberId.value),
      credentials,
    });
    showAddDialog.value = false;
    newCompanyId.value = '';
    newDisplayName.value = '';
    emit('changed');
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('couldNotLoad');
  } finally {
    adding.value = false;
  }
}
async function handleUpdateCreds() {
  if (!updateCredsAccount.value || updateCredsSaving.value) return;
  const credentials = updateCredsProvider.value?.fields.length
    ? Object.fromEntries(Object.entries(updateCredsValues.value).filter(([, v]) => v))
    : Object.fromEntries(
        updateCredsFields.value.filter((f) => f.key && f.value).map((f) => [f.key, f.value]),
      );
  if (!Object.keys(credentials).length) return;
  updateCredsSaving.value = true;
  error.value = '';
  try {
    await updateAccount(updateCredsAccount.value.id, { credentials });
    showUpdateCredsDialog.value = false;
    emit('changed');
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('couldNotLoad');
  } finally {
    updateCredsSaving.value = false;
  }
}
const {
  otpLabel: otpMessage,
  otpCode,
  otpSubmitting,
  otpDialogOpen: otpOpen,
  showOtpDialog,
  dismissOtpDialog: handleOtpCancel,
  handleOtpSubmit,
  showManualLoginDialog,
  manualLoginLabel: manualLoginMessage,
  manualLoginSubmitting,
  manualLoginDialogOpen: manualLoginOpen,
  dismissManualLoginDialog: handleManualLoginCancel,
  handleManualLoginConfirm,
  dismissByAccountId,
} = useOtpFlow();

const { connect } = useSseConnection({
  'otp-required': (data) => {
    if (data.accountId != null)
      showOtpDialog(data.accountId as number, (data.message as string) ?? '');
  },
  'manual-action-required': (data) => {
    if (data.accountId != null)
      showManualLoginDialog(data.accountId as number, (data.message as string) ?? '');
  },
  'scrape-done': (data) => {
    if (data.accountId != null) dismissByAccountId(data.accountId as number);
    emit('changed');
  },
  'scrape-error': (data) => {
    if (data.accountId != null) dismissByAccountId(data.accountId as number);
    emit('changed');
  },
});
onMounted(async () => {
  connect();
  try {
    members.value = (await getMembers()).members;
    newMemberId.value = String(activeMembers.value[0]?.id ?? '');
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('couldNotLoad');
  }
});
defineExpose({ openAdd, openUpdateCreds });
</script>
<template>
  <Dialog v-model:open="showAddDialog">
    <DialogContent class="sm:max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ language === 'he' ? 'הוספת חשבון' : 'Add account' }}</DialogTitle>
      </DialogHeader>

      <div class="space-y-5 py-2">
        <div class="flex flex-col gap-2">
          <label for="account-manager-field-2" class="text-[14px] font-medium">{{
            language === 'he' ? 'ספק' : 'Provider'
          }}</label>
          <Select v-model="newCompanyId">
            <SelectTrigger id="account-manager-field-2">
              <SelectValue :placeholder="language === 'he' ? 'בחירת ספק' : 'Select provider'" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem disabled value="_banks_label">{{ t('banks') }}</SelectItem>
              <SelectItem
                v-for="p in PROVIDERS.filter((p) => p.accountType === 'bank')"
                :key="p.id"
                :value="p.id"
              >
                {{ p.name }}
              </SelectItem>
              <SelectItem disabled value="_cc_label">{{ t('creditCards') }}</SelectItem>
              <SelectItem
                v-for="p in PROVIDERS.filter((p) => p.accountType === 'credit_card')"
                :key="p.id"
                :value="p.id"
              >
                {{ p.name }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div class="flex flex-col gap-2">
          <label for="account-manager-field-3" class="text-[14px] font-medium">{{
            language === 'he' ? 'שם החשבון' : 'Account name'
          }}</label>
          <Input
            id="account-manager-field-3"
            v-model="newDisplayName"
            :placeholder="language === 'he' ? 'למשל, החשבון הראשי' : 'e.g. Main account'"
          />
        </div>

        <div class="flex flex-col gap-2">
          <label for="account-manager-field-4" class="text-[14px] font-medium">{{
            t('owner')
          }}</label>
          <Select v-model="newMemberId">
            <SelectTrigger id="account-manager-field-4">
              <SelectValue :placeholder="language === 'he' ? 'בחירת בן בית' : 'Select member'" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="member in activeMembers"
                :key="member.id"
                :value="String(member.id)"
              >
                {{ member.name }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div v-if="newCompanyId" class="space-y-4">
          <!-- OTP note banner (e.g. OneZero) -->
          <div
            v-if="selectedProvider?.otpNote"
            class="rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-2.5 text-[14px] text-primary"
          >
            {{ selectedProvider.otpNote }}
          </div>

          <!-- Known provider: render labeled fields -->
          <template v-if="selectedProvider && selectedProvider.fields.length > 0">
            <div
              v-for="field in selectedProvider.fields"
              :key="field.key"
              class="flex flex-col gap-2"
            >
              <label class="text-[14px] font-medium">{{ field.label }}</label>
              <Input
                v-model="credentialValues[field.key]"
                :aria-label="field.label"
                :type="field.type"
                :placeholder="field.placeholder ?? ''"
                :autocomplete="field.type === 'password' ? 'current-password' : 'off'"
              />
              <p v-if="field.hint" class="text-[12px] text-text-tertiary">{{ field.hint }}</p>
            </div>
          </template>

          <!-- Unknown provider: generic key-value fallback -->
          <template v-else>
            <div class="space-y-2">
              <label class="text-[14px] font-medium">Credentials</label>
              <div
                v-for="(field, i) in credentialFields"
                :key="i"
                class="flex flex-col gap-2 sm:flex-row"
              >
                <Input
                  v-model="field.key"
                  aria-label="Credential field name"
                  placeholder="Field name (e.g. userCode)"
                />
                <Input
                  v-model="field.value"
                  aria-label="Credential value"
                  type="password"
                  placeholder="Value"
                />
              </div>
              <Button variant="secondary" size="sm" @click="addCredentialField">
                <Plus class="h-3 w-3 mr-1.5" />
                {{ language === 'he' ? 'הוספת שדה' : 'Add field' }}
              </Button>
            </div>
          </template>
        </div>
      </div>

      <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
      <DialogFooter>
        <DialogClose as-child>
          <Button variant="secondary">{{ t('cancel') }}</Button>
        </DialogClose>
        <Button
          variant="filled"
          :disabled="adding || !newCompanyId || !newDisplayName.trim() || !newMemberId"
          @click="handleAdd"
        >
          {{ adding ? t('saving') : t('save') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- OTP Dialog -->
  <Dialog
    :open="otpOpen"
    @update:open="
      (v) => {
        if (!v) handleOtpCancel();
      }
    "
  >
    <DialogContent class="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle>{{
          language === 'he' ? 'אימות דו־שלבי' : 'Two-factor authentication'
        }}</DialogTitle>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <p class="text-[14px] text-text-secondary">{{ otpMessage }}</p>
        <Input
          v-model="otpCode"
          :aria-label="language === 'he' ? 'קוד אימות' : 'Verification code'"
          inputmode="numeric"
          autocomplete="one-time-code"
          :placeholder="language === 'he' ? 'קוד אימות' : 'Verification code'"
          class="text-center text-lg tracking-widest font-mono"
          @keyup.enter="handleOtpSubmit"
        />
      </div>

      <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
      <DialogFooter>
        <Button variant="secondary" @click="handleOtpCancel">{{ t('cancel') }}</Button>
        <Button
          variant="filled"
          :disabled="!otpCode.trim() || otpSubmitting"
          @click="handleOtpSubmit"
        >
          <Loader2 v-if="otpSubmitting" class="h-4 w-4 mr-2 animate-spin" />
          {{ otpSubmitting ? t('saving') : language === 'he' ? 'אימות' : 'Verify' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- Manual Login Dialog -->
  <Dialog
    :open="manualLoginOpen"
    @update:open="
      (v) => {
        if (!v) handleManualLoginCancel();
      }
    "
  >
    <DialogContent class="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle>{{
          language === 'he' ? 'נדרשת כניסה ידנית' : 'Sign in to your bank'
        }}</DialogTitle>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <p class="text-[14px] text-text-secondary">{{ manualLoginMessage }}</p>
        <p class="text-[14px] text-text-secondary">
          {{
            language === 'he'
              ? 'לאחר הכניסה לבנק, המשיכו מכאן כדי לסנכרן את החשבון.'
              : 'Once you have signed in to your bank, continue here to sync the account.'
          }}
        </p>
      </div>

      <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
      <DialogFooter>
        <Button variant="secondary" @click="handleManualLoginCancel">{{ t('cancel') }}</Button>
        <Button
          variant="filled"
          :disabled="manualLoginSubmitting"
          @click="handleManualLoginConfirm"
        >
          <Loader2 v-if="manualLoginSubmitting" class="h-4 w-4 mr-2 animate-spin" />
          {{
            manualLoginSubmitting ? t('saving') : language === 'he' ? 'התחברתי' : 'I’ve signed in'
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- {{ language === 'he' ? 'עדכון פרטי כניסה' : 'Update credentials' }} Dialog -->
  <Dialog v-model:open="showUpdateCredsDialog">
    <DialogContent class="sm:max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{
          language === 'he' ? 'עדכון פרטי כניסה' : 'Update credentials'
        }}</DialogTitle>
      </DialogHeader>

      <div class="space-y-5 py-2">
        <p class="text-[14px] text-text-secondary">
          {{ language === 'he' ? 'עדכון פרטי הכניסה עבור' : 'Update sign-in details for' }}
          <span class="font-medium text-text-primary">{{ updateCredsAccount?.displayName }}</span
          >.
          {{
            language === 'he'
              ? 'רק שדות שתמלאו יעודכנו.'
              : 'Only fields you fill in will be updated.'
          }}
        </p>

        <!-- Known provider: render labeled fields -->
        <template v-if="updateCredsProvider && updateCredsProvider.fields.length > 0">
          <div
            v-for="field in updateCredsProvider.fields"
            :key="field.key"
            class="flex flex-col gap-2"
          >
            <label class="text-[14px] font-medium">{{ field.label }}</label>
            <Input
              v-model="updateCredsValues[field.key]"
              :aria-label="field.label"
              type="password"
              :placeholder="field.placeholder ?? ''"
              autocomplete="off"
            />
            <p v-if="field.hint" class="text-[12px] text-text-tertiary">{{ field.hint }}</p>
          </div>
        </template>

        <!-- Unknown provider: generic key-value fallback -->
        <template v-else>
          <div class="space-y-2">
            <label class="text-[14px] font-medium">Credentials</label>
            <div
              v-for="(field, i) in updateCredsFields"
              :key="i"
              class="flex flex-col gap-2 sm:flex-row"
            >
              <Input
                v-model="field.key"
                aria-label="Credential field name"
                placeholder="Field name (e.g. userCode)"
              />
              <Input
                v-model="field.value"
                aria-label="Credential value"
                type="password"
                placeholder="Value"
              />
            </div>
            <Button variant="secondary" size="sm" @click="addUpdateCredField">
              <Plus class="h-3 w-3 mr-1.5" />
              {{ language === 'he' ? 'הוספת שדה' : 'Add field' }}
            </Button>
          </div>
        </template>
      </div>

      <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
      <DialogFooter>
        <DialogClose as-child>
          <Button variant="secondary">{{ t('cancel') }}</Button>
        </DialogClose>
        <Button
          variant="filled"
          :disabled="updateCredsSaving || !credentialsChanged"
          @click="handleUpdateCreds"
        >
          <Loader2 v-if="updateCredsSaving" class="h-4 w-4 mr-2 animate-spin" />
          {{ updateCredsSaving ? t('saving') : t('save') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
