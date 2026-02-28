<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import {
  getAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  triggerScrape,
  createScrapeEventSource,
  submitOtp,
  confirmManualLogin,
  type Account,
} from '../api/client';
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
import { Loader2, Plus, Trash2, RefreshCw, Power } from 'lucide-vue-next';

const MANUAL_LOGIN_COMPANY_IDS = new Set(['isracard', 'amex']);

const accounts = ref<Account[]>([]);
const loading = ref(false);
const showAddDialog = ref(false);

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

// SSE & OTP state
let eventSource: EventSource | null = null;
const scrapingAccounts = ref(new Set<number>());
const otpAccountId = ref<number | null>(null);
const otpMessage = ref('');
const otpCode = ref('');
const otpSubmitting = ref(false);

// Manual login state
const manualLoginAccountId = ref<number | null>(null);
const manualLoginMessage = ref('');
const manualLoginSubmitting = ref(false);

function connectSse() {
  eventSource = createScrapeEventSource();

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data) as {
      type: string;
      accountId?: number;
      message?: string;
    };

    switch (data.type) {
      case 'otp-required':
        if (data.accountId != null) {
          otpAccountId.value = data.accountId;
          otpMessage.value = data.message ?? 'Enter OTP code';
          otpCode.value = '';
        }
        break;

      case 'manual-action-required':
        if (data.accountId != null) {
          manualLoginAccountId.value = data.accountId;
          manualLoginMessage.value = data.message ?? 'Please log in manually in the browser window.';
        }
        break;

      case 'scrape-started':
        if (data.accountId != null) {
          scrapingAccounts.value.add(data.accountId);
          scrapingAccounts.value = new Set(scrapingAccounts.value);
        }
        break;

      case 'scrape-done':
      case 'scrape-error':
        if (data.accountId != null) {
          scrapingAccounts.value.delete(data.accountId);
          scrapingAccounts.value = new Set(scrapingAccounts.value);
          if (otpAccountId.value === data.accountId) {
            otpAccountId.value = null;
          }
          if (manualLoginAccountId.value === data.accountId) {
            manualLoginAccountId.value = null;
          }
          fetchAccounts();
        }
        break;
    }
  };

  eventSource.onerror = () => {
    eventSource?.close();
    setTimeout(connectSse, 3000);
  };
}

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

async function handleDelete(account: Account) {
  await deleteAccount(account.id, true);
  fetchAccounts();
}

async function handleScrape(account: Account) {
  if (scrapingAccounts.value.has(account.id)) return;
  try {
    const result = await triggerScrape(account.id);
    alert(`Scrape complete: ${result.transactionsFound} found, ${result.transactionsNew} new`);
    fetchAccounts();
  } catch (err) {
    alert(`Scrape failed: ${err instanceof Error ? err.message : err}`);
  }
}

async function handleOtpSubmit() {
  if (!otpAccountId.value || !otpCode.value.trim()) return;
  otpSubmitting.value = true;
  try {
    await submitOtp(otpAccountId.value, otpCode.value.trim());
    otpAccountId.value = null;
    otpCode.value = '';
  } catch (err) {
    alert(`OTP submit failed: ${err instanceof Error ? err.message : err}`);
  } finally {
    otpSubmitting.value = false;
  }
}

function handleOtpCancel() {
  otpAccountId.value = null;
  otpCode.value = '';
}

async function handleManualLoginConfirm() {
  if (!manualLoginAccountId.value) return;
  manualLoginSubmitting.value = true;
  try {
    await confirmManualLogin(manualLoginAccountId.value);
    manualLoginAccountId.value = null;
  } catch (err) {
    alert(`Confirm failed: ${err instanceof Error ? err.message : err}`);
  } finally {
    manualLoginSubmitting.value = false;
  }
}

function handleManualLoginCancel() {
  manualLoginAccountId.value = null;
}

onMounted(() => {
  fetchAccounts();
  connectSse();
});

onUnmounted(() => {
  eventSource?.close();
});
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold tracking-tight">Accounts</h1>
      <Button @click="showAddDialog = true">
        <Plus class="h-4 w-4 mr-2" />
        Add Account
      </Button>
    </div>

    <!-- Loading skeletons -->
    <div v-if="loading" class="space-y-3">
      <Skeleton v-for="i in 3" :key="i" class="h-24 w-full rounded-lg" />
    </div>

    <!-- Account cards -->
    <div v-else class="space-y-6">
      <p v-if="accounts.length === 0" class="text-muted-foreground text-sm text-center py-12">
        No accounts configured. Add one to get started.
      </p>

      <div v-for="section in accountSections" :key="section.type" class="space-y-3">
        <h2 class="text-lg font-medium tracking-tight">{{ section.label }}</h2>
        <Card v-for="account in section.accounts" :key="account.id">
          <CardContent class="pt-4">
            <div class="flex items-start justify-between gap-4">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <CardTitle class="text-base">{{ account.displayName }}</CardTitle>
                  <Badge
                    :variant="account.isActive ? 'default' : 'secondary'"
                    class="text-xs"
                  >
                    {{ account.isActive ? 'Active' : 'Inactive' }}
                  </Badge>
                </div>
                <CardDescription class="text-sm">
                  {{ PROVIDERS.find(p => p.id === account.companyId)?.name ?? account.companyId }}
                  <span v-if="account.accountNumber"> · {{ account.accountNumber }}</span>
                </CardDescription>
                <p v-if="section.type === 'bank' && account.balance != null" class="text-lg font-semibold mt-1">
                  {{ account.balance.toLocaleString('he-IL', { style: 'currency', currency: 'ILS' }) }}
                </p>
                <p class="text-xs text-muted-foreground mt-1">
                  <span v-if="account.lastScrapedAt">
                    Last scraped: {{ new Date(account.lastScrapedAt).toLocaleString('he-IL') }}
                  </span>
                  <span v-else>Never scraped</span>
                </p>
                <div class="flex items-center gap-4 mt-2">
                  <label v-if="MANUAL_LOGIN_COMPANY_IDS.has(account.companyId)" class="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Switch :model-value="account.manualLogin" @update:model-value="patchAccount(account.id, { manualLogin: $event })" />
                    Manual login
                  </label>
                  <label class="flex items-center gap-1.5 text-xs text-muted-foreground">
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
                  <Loader2 v-if="scrapingAccounts.has(account.id)" class="h-3 w-3 mr-1 animate-spin" />
                  <RefreshCw v-else class="h-3 w-3 mr-1" />
                  {{ scrapingAccounts.has(account.id) ? 'Scraping...' : 'Scrape' }}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  @click="patchAccount(account.id, { isActive: !account.isActive })"
                >
                  <Power class="h-3 w-3 mr-1" />
                  {{ account.isActive ? 'Disable' : 'Enable' }}
                </Button>

                <AlertDialog>
                  <AlertDialogTrigger as-child>
                    <Button variant="destructive" size="sm">
                      <Trash2 class="h-3 w-3" />
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

        <div class="space-y-4 py-2">
          <div class="space-y-1.5">
            <label class="text-sm font-medium">Provider</label>
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
            <label class="text-sm font-medium">Display Name</label>
            <Input v-model="newDisplayName" placeholder="e.g. My Hapoalim Account" />
          </div>

          <div v-if="newCompanyId" class="space-y-3">
            <!-- OTP note banner (e.g. OneZero) -->
            <div
              v-if="selectedProvider?.otpNote"
              class="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
            >
              {{ selectedProvider.otpNote }}
            </div>

            <!-- Known provider: render labeled fields -->
            <template v-if="selectedProvider && selectedProvider.fields.length > 0">
              <div v-for="field in selectedProvider.fields" :key="field.key" class="space-y-1">
                <label class="text-sm font-medium">{{ field.label }}</label>
                <Input
                  v-model="credentialValues[field.key]"
                  :type="field.type"
                  :placeholder="field.placeholder ?? ''"
                  :autocomplete="field.type === 'password' ? 'current-password' : 'off'"
                />
                <p v-if="field.hint" class="text-xs text-muted-foreground">{{ field.hint }}</p>
              </div>
            </template>

            <!-- Unknown provider: generic key-value fallback -->
            <template v-else>
              <div class="space-y-1.5">
                <label class="text-sm font-medium">Credentials</label>
                <div v-for="(field, i) in credentialFields" :key="i" class="flex gap-2">
                  <Input v-model="field.key" placeholder="Field name (e.g. userCode)" />
                  <Input v-model="field.value" type="password" placeholder="Value" />
                </div>
                <Button variant="outline" size="sm" @click="addCredentialField">
                  <Plus class="h-3 w-3 mr-1" />
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
    <Dialog :open="otpAccountId !== null" @update:open="(v) => { if (!v) handleOtpCancel() }">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Two-Factor Authentication</DialogTitle>
        </DialogHeader>

        <div class="space-y-4 py-2">
          <p class="text-sm text-muted-foreground">{{ otpMessage }}</p>
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
    <Dialog :open="manualLoginAccountId !== null" @update:open="(v) => { if (!v) handleManualLoginCancel() }">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Manual Login Required</DialogTitle>
        </DialogHeader>

        <div class="space-y-4 py-2">
          <p class="text-sm text-muted-foreground">{{ manualLoginMessage }}</p>
          <p class="text-sm text-muted-foreground">
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
