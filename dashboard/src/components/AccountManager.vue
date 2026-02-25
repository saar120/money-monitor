<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import {
  getAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  triggerScrape,
  createScrapeEventSource,
  submitOtp,
  type Account,
} from '../api/client';
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
import { Loader2, Plus, Trash2, RefreshCw, Power } from 'lucide-vue-next';

const accounts = ref<Account[]>([]);
const loading = ref(false);
const showAddDialog = ref(false);

const newCompanyId = ref('');
const newDisplayName = ref('');
const credentialFields = ref<Array<{ key: string; value: string }>>([{ key: '', value: '' }]);

// SSE & OTP state
let eventSource: EventSource | null = null;
const scrapingAccounts = ref(new Set<number>());
const otpAccountId = ref<number | null>(null);
const otpMessage = ref('');
const otpCode = ref('');
const otpSubmitting = ref(false);

const providers = [
  { id: 'hapoalim', name: 'Bank Hapoalim' },
  { id: 'leumi', name: 'Bank Leumi' },
  { id: 'discount', name: 'Bank Discount' },
  { id: 'mizrahi', name: 'Bank Mizrahi' },
  { id: 'otsarHahayal', name: 'Otsar Hahayal' },
  { id: 'mercantile', name: 'Mercantile' },
  { id: 'massad', name: 'Massad' },
  { id: 'beinleumi', name: 'First International' },
  { id: 'union', name: 'Union Bank' },
  { id: 'yahav', name: 'Bank Yahav' },
  { id: 'isracard', name: 'Isracard' },
  { id: 'amex', name: 'American Express (Israel)' },
  { id: 'max', name: 'Max (Leumi Card)' },
  { id: 'visaCal', name: 'Visa Cal' },
  { id: 'beyahadBishvilha', name: 'Beyond (Beyahad)' },
  { id: 'oneZero', name: 'One Zero' },
  { id: 'behatsdaa', name: 'Behatsdaa' },
  { id: 'pagi', name: 'Pagi' },
];

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
  for (const field of credentialFields.value) {
    if (field.key) credentials[field.key] = field.value;
  }

  await createAccount({
    companyId: newCompanyId.value,
    displayName: newDisplayName.value,
    credentials,
  });

  newCompanyId.value = '';
  newDisplayName.value = '';
  credentialFields.value = [{ key: '', value: '' }];
  showAddDialog.value = false;
  fetchAccounts();
}

async function handleToggleActive(account: Account) {
  await updateAccount(account.id, { isActive: !account.isActive });
  fetchAccounts();
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
    <div v-else class="space-y-3">
      <p v-if="accounts.length === 0" class="text-muted-foreground text-sm text-center py-12">
        No accounts configured. Add one to get started.
      </p>

      <Card v-for="account in accounts" :key="account.id">
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
                {{ providers.find(p => p.id === account.companyId)?.name ?? account.companyId }}
                <span v-if="account.accountNumber"> · {{ account.accountNumber }}</span>
              </CardDescription>
              <p class="text-xs text-muted-foreground mt-1">
                <span v-if="account.lastScrapedAt">
                  Last scraped: {{ new Date(account.lastScrapedAt).toLocaleString('he-IL') }}
                </span>
                <span v-else>Never scraped</span>
              </p>
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
                @click="handleToggleActive(account)"
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
                <SelectItem v-for="p in providers" :key="p.id" :value="p.id">
                  {{ p.name }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="space-y-1.5">
            <label class="text-sm font-medium">Display Name</label>
            <Input v-model="newDisplayName" placeholder="e.g. My Hapoalim Account" />
          </div>

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
  </div>
</template>
