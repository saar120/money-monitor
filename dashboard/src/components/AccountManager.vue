<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import {
  getAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  triggerScrape,
  type Account,
} from '../api/client';
import { useOtpFlow } from '../composables/useOtpFlow';
import { useSseConnection } from '../composables/useSseConnection';
import { PROVIDERS } from '@/lib/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Loader2, Plus, Trash2, RefreshCw, Power, Pencil, Check, X, Building2 } from 'lucide-vue-next';

const MANUAL_LOGIN_COMPANY_IDS = new Set(['isracard', 'amex']);

const accounts = ref<Account[]>([]);
const loading = ref(false);
const showAddDialog = ref(false);
const editingNameId = ref<number | null>(null);
const editNameValue = ref('');

const newCompanyId = ref('');
const newDisplayName = ref('');
// For providers with known schema
const credentialValues = ref<Record<string, string>>({});
// For providers with unknown schema (generic fallback)
const credentialFields = ref<Array<{ key: string; value: string }>>([{ key: '', value: '' }]);

const selectedProvider = computed(() =>
  PROVIDERS.find((p) => p.id === newCompanyId.value) ?? null,
);

const bankAccounts = computed(() =>
  accounts.value.filter(a => a.accountType === 'bank')
);
const creditCardAccounts = computed(() =>
  accounts.value.filter(a => a.accountType === 'credit_card')
);

const accountSections = computed(() => [
  { type: 'bank' as const, label: 'Banks', accounts: bankAccounts.value },
  { type: 'credit_card' as const, label: 'Credit Cards', accounts: creditCardAccounts.value },
].filter(s => s.accounts.length > 0));

watch(newCompanyId, () => {
  credentialValues.value = {};
  credentialFields.value = [{ key: '', value: '' }];
});

// SSE & OTP/Manual login
const scrapingAccounts = ref(new Set<number>());

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

function onScrapeFinished(data: Record<string, unknown>) {
  if (data.accountId != null) {
    scrapingAccounts.value.delete(data.accountId as number);
    dismissByAccountId(data.accountId as number);
    fetchAccounts();
  }
}

const { connect: connectSse } = useSseConnection({
  'otp-required': (data) => {
    if (data.accountId != null) {
      showOtpDialog(data.accountId as number, (data.message as string) ?? 'Enter OTP code');
    }
  },
  'manual-action-required': (data) => {
    if (data.accountId != null) {
      showManualLoginDialog(
        data.accountId as number,
        (data.message as string) ?? 'Please log in manually in the browser window.',
      );
    }
  },
  'scrape-started': (data) => {
    if (data.accountId != null) {
      scrapingAccounts.value.add(data.accountId as number);
    }
  },
  'scrape-done': onScrapeFinished,
  'scrape-error': onScrapeFinished,
});

async function fetchAccounts() {
  loading.value = true;
  try {
    const result = await getAccounts();
    accounts.value = result.accounts;
  } finally {
    loading.value = false;
  }
}

function addCredentialField() {
  credentialFields.value.push({ key: '', value: '' });
}

async function handleAdd() {
  const credentials: Record<string, string> = {};

  if (selectedProvider.value && selectedProvider.value.fields.length > 0) {
    Object.assign(credentials, credentialValues.value);
  } else {
    for (const field of credentialFields.value) {
      if (field.key) credentials[field.key] = field.value;
    }
  }

  await createAccount({
    companyId: newCompanyId.value,
    displayName: newDisplayName.value,
    credentials,
  });

  newCompanyId.value = '';
  newDisplayName.value = '';
  credentialValues.value = {};
  credentialFields.value = [{ key: '', value: '' }];
  showAddDialog.value = false;
  fetchAccounts();
}

async function patchAccount(id: number, data: Parameters<typeof updateAccount>[1]) {
  const { account: updated } = await updateAccount(id, data);
  const idx = accounts.value.findIndex(a => a.id === updated.id);
  if (idx !== -1) accounts.value[idx] = updated;
}

function startEditName(account: Account) {
  editingNameId.value = account.id;
  editNameValue.value = account.displayName;
}

function cancelEditName() {
  editingNameId.value = null;
  editNameValue.value = '';
}

async function saveEditName(account: Account) {
  const trimmed = editNameValue.value.trim();
  if (!trimmed || trimmed === account.displayName) {
    cancelEditName();
    return;
  }
  try {
    await patchAccount(account.id, { displayName: trimmed });
  } catch (err) {
    console.error('Failed to rename account:', err);
  }
  cancelEditName();
}

async function handleDelete(account: Account) {
  await deleteAccount(account.id, true);
  fetchAccounts();
}

async function handleScrape(account: Account) {
  if (scrapingAccounts.value.has(account.id)) return;
  try {
    const result = await triggerScrape(account.id);
    alert(`Scrape started (session #${result.sessionId})`);
    fetchAccounts();
  } catch (err) {
    alert(`Scrape failed: ${err instanceof Error ? err.message : err}`);
  }
}

onMounted(() => {
  fetchAccounts();
  connectSse();
});
</script>

<template>
  <div class="flex flex-col h-full min-h-0 animate-fade-in-up">
    <!-- Header -->
    <div class="flex items-center justify-between flex-shrink-0 mb-5">
      <Button @click="showAddDialog = true">
        <Plus class="h-4 w-4 mr-2" />
        Add Account
      </Button>
    </div>

    <!-- Loading skeletons -->
    <div v-if="loading" class="space-y-4 flex-1 min-h-0 overflow-y-auto">
      <Skeleton v-for="i in 3" :key="i" class="h-28 w-full rounded-xl" />
    </div>

    <!-- Account cards -->
    <div v-else class="space-y-6 flex-1 min-h-0 overflow-y-auto">
      <!-- Empty state -->
      <div v-if="accounts.length === 0" class="flex flex-col items-center justify-center py-20">
        <div class="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
          <Building2 class="h-8 w-8 text-primary" />
        </div>
        <p class="text-[15px] font-medium text-text-primary mb-1">No Accounts</p>
        <p class="text-text-secondary text-[13px] mb-5">Add a bank or credit card to start tracking</p>
        <Button @click="showAddDialog = true">
          <Plus class="h-4 w-4 mr-2" /> Add Account
        </Button>
      </div>

      <div v-for="section in accountSections" :key="section.type" class="space-y-3">
        <h2 class="text-[15px] font-semibold text-text-primary">{{ section.label }}</h2>
        <Card v-for="account in section.accounts" :key="account.id">
          <CardContent class="p-5">
            <div class="flex items-start justify-between gap-4">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2.5 mb-1">
                  <template v-if="editingNameId === account.id">
                    <div class="flex items-center gap-1.5">
                      <Input
                        v-model="editNameValue"
                        class="h-7 text-[13px] w-48"
                        @keyup.enter="saveEditName(account)"
                        @keyup.escape="cancelEditName"
                      />
                      <button @click="saveEditName(account)" class="p-1.5 rounded-lg text-success hover:bg-success/10 transition-colors">
                        <Check class="h-4 w-4" />
                      </button>
                      <button @click="cancelEditName" class="p-1.5 rounded-lg text-text-secondary hover:bg-bg-tertiary transition-colors">
                        <X class="h-4 w-4" />
                      </button>
                    </div>
                  </template>
                  <div v-else class="flex items-center gap-1.5 group">
                    <CardTitle class="text-[15px]">{{ account.displayName }}</CardTitle>
                    <button
                      @click="startEditName(account)"
                      class="p-1 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-bg-tertiary text-text-secondary hover:text-text-primary transition-all duration-150"
                    >
                      <Pencil class="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <Badge
                    :variant="account.isActive ? 'default' : 'secondary'"
                    :class="account.isActive ? 'bg-success/10 text-success border-0' : ''"
                    class="text-[11px]"
                  >
                    {{ account.isActive ? 'Active' : 'Inactive' }}
                  </Badge>
                </div>
                <CardDescription class="text-[13px]">
                  {{ PROVIDERS.find(p => p.id === account.companyId)?.name ?? account.companyId }}
                  <span v-if="account.accountNumber"> · {{ account.accountNumber }}</span>
                </CardDescription>
                <p v-if="section.type === 'bank' && account.balance != null" class="text-[18px] font-semibold mt-1.5 tabular-nums">
                  {{ account.balance.toLocaleString('he-IL', { style: 'currency', currency: 'ILS' }) }}
                </p>
                <p class="text-[12px] text-text-tertiary mt-1.5">
                  <span v-if="account.lastScrapedAt">
                    Last scraped: {{ new Date(account.lastScrapedAt).toLocaleString('he-IL') }}
                  </span>
                  <span v-else>Never scraped</span>
                </p>
                <div class="flex items-center gap-5 mt-3">
                  <label v-if="MANUAL_LOGIN_COMPANY_IDS.has(account.companyId)" class="flex items-center gap-2 text-[12px] text-text-secondary">
                    <Switch :model-value="account.manualLogin" @update:model-value="patchAccount(account.id, { manualLogin: $event })" />
                    Manual login
                  </label>
                  <label class="flex items-center gap-2 text-[12px] text-text-secondary">
                    <Switch :model-value="account.showBrowser" :disabled="account.manualLogin" @update:model-value="patchAccount(account.id, { showBrowser: $event })" />
                    Show browser
                  </label>
                </div>
              </div>

              <div class="flex items-center gap-2 flex-shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="scrapingAccounts.has(account.id)"
                  @click="handleScrape(account)"
                >
                  <Loader2 v-if="scrapingAccounts.has(account.id)" class="h-3 w-3 mr-1.5 animate-spin" />
                  <RefreshCw v-else class="h-3 w-3 mr-1.5" />
                  {{ scrapingAccounts.has(account.id) ? 'Scraping...' : 'Scrape' }}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  @click="patchAccount(account.id, { isActive: !account.isActive })"
                >
                  <Power class="h-3 w-3 mr-1.5" />
                  {{ account.isActive ? 'Disable' : 'Enable' }}
                </Button>

                <AlertDialog>
                  <AlertDialogTrigger as-child>
                    <Button variant="ghost" size="icon-sm" class="text-text-tertiary hover:text-destructive">
                      <Trash2 class="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete "{{ account.displayName }}"?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete the account and all its transactions. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        @click="handleDelete(account)"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- Add Account Dialog -->
    <Dialog v-model:open="showAddDialog">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Account</DialogTitle>
        </DialogHeader>

        <div class="space-y-5 py-2">
          <div class="space-y-1.5">
            <label class="text-[13px] font-medium">Provider</label>
            <Select v-model="newCompanyId">
              <SelectTrigger>
                <SelectValue placeholder="Select provider..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem disabled value="_banks_label">— Banks —</SelectItem>
                <SelectItem v-for="p in PROVIDERS.filter(p => p.accountType === 'bank')" :key="p.id" :value="p.id">
                  {{ p.name }}
                </SelectItem>
                <SelectItem disabled value="_cc_label">— Credit Cards —</SelectItem>
                <SelectItem v-for="p in PROVIDERS.filter(p => p.accountType === 'credit_card')" :key="p.id" :value="p.id">
                  {{ p.name }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="space-y-1.5">
            <label class="text-[13px] font-medium">Display Name</label>
            <Input v-model="newDisplayName" placeholder="e.g. My Hapoalim Account" />
          </div>

          <div v-if="newCompanyId" class="space-y-4">
            <!-- OTP note banner (e.g. OneZero) -->
            <div
              v-if="selectedProvider?.otpNote"
              class="rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-2.5 text-[13px] text-primary"
            >
              {{ selectedProvider.otpNote }}
            </div>

            <!-- Known provider: render labeled fields -->
            <template v-if="selectedProvider && selectedProvider.fields.length > 0">
              <div v-for="field in selectedProvider.fields" :key="field.key" class="space-y-1.5">
                <label class="text-[13px] font-medium">{{ field.label }}</label>
                <Input
                  v-model="credentialValues[field.key]"
                  :type="field.type"
                  :placeholder="field.placeholder ?? ''"
                  :autocomplete="field.type === 'password' ? 'current-password' : 'off'"
                />
                <p v-if="field.hint" class="text-[11px] text-text-tertiary">{{ field.hint }}</p>
              </div>
            </template>

            <!-- Unknown provider: generic key-value fallback -->
            <template v-else>
              <div class="space-y-2">
                <label class="text-[13px] font-medium">Credentials</label>
                <div v-for="(field, i) in credentialFields" :key="i" class="flex gap-2">
                  <Input v-model="field.key" placeholder="Field name (e.g. userCode)" />
                  <Input v-model="field.value" type="password" placeholder="Value" />
                </div>
                <Button variant="outline" size="sm" @click="addCredentialField">
                  <Plus class="h-3 w-3 mr-1.5" />
                  Add Field
                </Button>
              </div>
            </template>
          </div>
        </div>

        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            :disabled="!newCompanyId || !newDisplayName"
            @click="handleAdd"
          >
            Save Account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- OTP Dialog -->
    <Dialog :open="otpOpen" @update:open="(v) => { if (!v) handleOtpCancel() }">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Two-Factor Authentication</DialogTitle>
        </DialogHeader>

        <div class="space-y-4 py-2">
          <p class="text-[13px] text-text-secondary">{{ otpMessage }}</p>
          <Input
            v-model="otpCode"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder="Enter code..."
            class="text-center text-lg tracking-widest font-mono"
            @keyup.enter="handleOtpSubmit"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" @click="handleOtpCancel">Cancel</Button>
          <Button
            :disabled="!otpCode.trim() || otpSubmitting"
            @click="handleOtpSubmit"
          >
            <Loader2 v-if="otpSubmitting" class="h-4 w-4 mr-2 animate-spin" />
            {{ otpSubmitting ? 'Submitting...' : 'Submit' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Manual Login Dialog -->
    <Dialog :open="manualLoginOpen" @update:open="(v) => { if (!v) handleManualLoginCancel() }">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Manual Login Required</DialogTitle>
        </DialogHeader>

        <div class="space-y-4 py-2">
          <p class="text-[13px] text-text-secondary">{{ manualLoginMessage }}</p>
          <p class="text-[13px] text-text-secondary">
            Once you've successfully logged in, click the button below to continue scraping.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="handleManualLoginCancel">Cancel</Button>
          <Button
            :disabled="manualLoginSubmitting"
            @click="handleManualLoginConfirm"
          >
            <Loader2 v-if="manualLoginSubmitting" class="h-4 w-4 mr-2 animate-spin" />
            {{ manualLoginSubmitting ? 'Confirming...' : "I've Logged In" }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
