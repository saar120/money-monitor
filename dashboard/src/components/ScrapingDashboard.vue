<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  getAccounts,
  getScrapeSessions,
  triggerScrape,
  triggerScrapeAll,
  cancelScrapeSession,
  createScrapeEventSource,
  submitOtp,
  confirmManualLogin,
  type Account,
  type ScrapeSession,
} from '../api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Play,
  Square,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ChevronDown,
  ChevronRight,
} from 'lucide-vue-next';

// ─── State ───
const accounts = ref<Account[]>([]);
const sessions = ref<ScrapeSession[]>([]);
const loading = ref(true);
const triggerLoading = ref(false);
const expandedSessions = ref<Set<number>>(new Set());

// ─── Active session live state (from SSE) ───
interface LiveAccountStatus {
  accountId: number;
  status: 'queued' | 'scraping' | 'done' | 'error';
  transactionsFound?: number;
  transactionsNew?: number;
  durationMs?: number;
  error?: string;
}

interface LiveSession {
  sessionId: number;
  trigger: string;
  accountIds: number[];
  accounts: Map<number, LiveAccountStatus>;
  startedAt: number; // Date.now() timestamp
}

const liveSession = ref<LiveSession | null>(null);
const elapsedSeconds = ref(0);
let elapsedTimer: ReturnType<typeof setInterval> | null = null;

// ─── OTP/Manual login dialogs ───
const otpDialog = ref(false);
const otpAccountId = ref<number | null>(null);
const otpAccountName = ref('');
const otpCode = ref('');
const otpSubmitting = ref(false);

const manualLoginDialog = ref(false);
const manualLoginAccountId = ref<number | null>(null);
const manualLoginAccountName = ref('');
const manualLoginSubmitting = ref(false);

// ─── Helpers ───
function getAccountName(id: number): string {
  return accounts.value.find(a => a.id === id)?.displayName ?? `Account #${id}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSec = seconds % 60;
  return `${minutes}m ${remainingSec}s`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function triggerLabel(trigger: string): string {
  if (trigger === 'scheduled') return 'Scheduled';
  if (trigger === 'single') return 'Single Account';
  return 'Manual';
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'completed' || status === 'success') return 'default';
  if (status === 'running' || status === 'scraping') return 'secondary';
  if (status === 'error' || status === 'cancelled') return 'destructive';
  return 'outline';
}

function sessionAccountNames(session: ScrapeSession): string {
  const logs = session.logs ?? [];
  if (logs.length === 0) return '';
  const names = [...new Set(logs.map(l => l.accountName))];
  return names.join(', ');
}

function sessionSummary(session: ScrapeSession): string {
  const logs = session.logs ?? [];
  if (logs.length === 0) return 'No results';
  const ok = logs.filter(l => l.status === 'success').length;
  const fail = logs.filter(l => l.status === 'error').length;
  const totalFound = logs.reduce((sum, l) => sum + (l.transactionsFound ?? 0), 0);
  const totalNew = logs.reduce((sum, l) => sum + (l.transactionsNew ?? 0), 0);
  const parts: string[] = [];
  if (ok > 0) parts.push(`${ok} ok`);
  if (fail > 0) parts.push(`${fail} failed`);
  parts.push(`${totalFound} txns`);
  if (totalNew > 0) parts.push(`${totalNew} new`);
  return parts.join(' · ');
}

function toggleExpand(sessionId: number) {
  if (expandedSessions.value.has(sessionId)) {
    expandedSessions.value.delete(sessionId);
  } else {
    expandedSessions.value.add(sessionId);
  }
}

// ─── Data loading ───
async function loadData() {
  loading.value = true;
  try {
    const [accountsRes, sessionsRes] = await Promise.all([
      getAccounts(),
      getScrapeSessions({ limit: 50 }),
    ]);
    accounts.value = accountsRes.accounts;
    sessions.value = sessionsRes.sessions;
  } finally {
    loading.value = false;
  }
}

// ─── Actions ───
async function handleScrapeAll() {
  triggerLoading.value = true;
  try {
    await triggerScrapeAll();
  } catch {
    // SSE will update state
  } finally {
    triggerLoading.value = false;
  }
}

async function handleScrapeAccount(accountId: number) {
  triggerLoading.value = true;
  try {
    await triggerScrape(accountId);
  } catch {
    // SSE will update state
  } finally {
    triggerLoading.value = false;
  }
}

async function handleCancel() {
  if (!liveSession.value) return;
  try {
    await cancelScrapeSession(liveSession.value.sessionId);
  } catch {
    // SSE will update state
  }
}

async function handleOtpSubmit() {
  if (!otpAccountId.value || !otpCode.value) return;
  otpSubmitting.value = true;
  try {
    await submitOtp(otpAccountId.value, otpCode.value);
    otpDialog.value = false;
    otpCode.value = '';
  } finally {
    otpSubmitting.value = false;
  }
}

async function handleManualLoginConfirm() {
  if (!manualLoginAccountId.value) return;
  manualLoginSubmitting.value = true;
  try {
    await confirmManualLogin(manualLoginAccountId.value);
    manualLoginDialog.value = false;
  } finally {
    manualLoginSubmitting.value = false;
  }
}

// ─── SSE Connection ───
let eventSource: EventSource | null = null;

function startElapsedTimer() {
  stopElapsedTimer();
  elapsedSeconds.value = 0;
  elapsedTimer = setInterval(() => { elapsedSeconds.value++; }, 1000);
}

function stopElapsedTimer() {
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
}

function connectSse() {
  eventSource = createScrapeEventSource();

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);

    switch (data.type) {
      case 'session-started': {
        liveSession.value = {
          sessionId: data.sessionId,
          trigger: data.trigger,
          accountIds: data.accountIds,
          accounts: new Map(
            data.accountIds.map((id: number) => [id, { accountId: id, status: 'queued' as const }])
          ),
          startedAt: Date.now(),
        };
        startElapsedTimer();
        break;
      }

      case 'account-scrape-started': {
        if (liveSession.value?.accounts) {
          liveSession.value.accounts.set(data.accountId, {
            accountId: data.accountId,
            status: 'scraping',
          });
          // Trigger reactivity
          liveSession.value = { ...liveSession.value };
        }
        break;
      }

      case 'account-scrape-done': {
        if (liveSession.value?.accounts) {
          liveSession.value.accounts.set(data.accountId, {
            accountId: data.accountId,
            status: 'done',
            transactionsFound: data.transactionsFound,
            transactionsNew: data.transactionsNew,
            durationMs: data.durationMs,
          });
          liveSession.value = { ...liveSession.value };
        }
        break;
      }

      case 'account-scrape-error': {
        if (liveSession.value?.accounts) {
          liveSession.value.accounts.set(data.accountId, {
            accountId: data.accountId,
            status: 'error',
            error: data.error,
            durationMs: data.durationMs,
          });
          liveSession.value = { ...liveSession.value };
        }
        break;
      }

      case 'session-completed': {
        liveSession.value = null;
        stopElapsedTimer();
        // Reload session history
        loadData();
        break;
      }

      case 'otp-required': {
        otpAccountId.value = data.accountId;
        otpAccountName.value = getAccountName(data.accountId);
        otpDialog.value = true;
        break;
      }

      case 'manual-action-required': {
        manualLoginAccountId.value = data.accountId;
        manualLoginAccountName.value = getAccountName(data.accountId);
        manualLoginDialog.value = true;
        break;
      }
    }
  };

  eventSource.onerror = () => {
    eventSource?.close();
    setTimeout(connectSse, 3000);
  };
}

// ─── Lifecycle ───
onMounted(() => {
  loadData();
  connectSse();
});

onUnmounted(() => {
  eventSource?.close();
  stopElapsedTimer();
});

const activeAccounts = computed(() => accounts.value.filter(a => a.isActive));
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Scraping</h1>
        <p class="text-sm text-muted-foreground">Monitor and manage bank scrapes</p>
      </div>
      <div class="flex items-center gap-2">
        <Select @update:model-value="(v) => v != null && handleScrapeAccount(Number(v))">
          <SelectTrigger class="w-[200px]">
            <SelectValue placeholder="Scrape account..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="account in activeAccounts"
              :key="account.id"
              :value="String(account.id)"
            >
              {{ account.displayName }}
            </SelectItem>
          </SelectContent>
        </Select>
        <Button
          @click="handleScrapeAll"
          :disabled="triggerLoading || !!liveSession"
        >
          <Loader2 v-if="triggerLoading" class="mr-2 h-4 w-4 animate-spin" />
          <Play v-else class="mr-2 h-4 w-4" />
          Scrape All
        </Button>
      </div>
    </div>

    <!-- Active Session Banner -->
    <Card v-if="liveSession" class="border-blue-500/50 bg-blue-500/5">
      <CardHeader class="pb-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <Loader2 class="h-5 w-5 animate-spin text-blue-500" />
            <CardTitle class="text-base">
              Active Scrape
              <Badge variant="secondary" class="ml-2">{{ triggerLabel(liveSession.trigger) }}</Badge>
            </CardTitle>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-sm text-muted-foreground">
              <Clock class="inline h-3.5 w-3.5 mr-1" />
              {{ elapsedSeconds }}s
            </span>
            <Button variant="destructive" size="sm" @click="handleCancel">
              <Square class="mr-1.5 h-3.5 w-3.5" />
              Cancel
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div class="space-y-2">
          <div
            v-for="[accountId, accountStatus] in liveSession.accounts"
            :key="accountId"
            class="flex items-center gap-3 text-sm"
          >
            <!-- Status icon -->
            <Loader2
              v-if="accountStatus.status === 'scraping'"
              class="h-4 w-4 animate-spin text-blue-500 flex-shrink-0"
            />
            <CheckCircle2
              v-else-if="accountStatus.status === 'done'"
              class="h-4 w-4 text-green-500 flex-shrink-0"
            />
            <XCircle
              v-else-if="accountStatus.status === 'error'"
              class="h-4 w-4 text-red-500 flex-shrink-0"
            />
            <div
              v-else
              class="h-4 w-4 rounded-full border-2 border-muted-foreground/30 flex-shrink-0"
            />

            <!-- Account name -->
            <span class="w-40 truncate font-medium">{{ getAccountName(accountId) }}</span>

            <!-- Status text -->
            <span class="text-muted-foreground">
              <template v-if="accountStatus.status === 'queued'">Queued</template>
              <template v-else-if="accountStatus.status === 'scraping'">Scraping...</template>
              <template v-else-if="accountStatus.status === 'done'">
                {{ accountStatus.transactionsFound }} txns
                <template v-if="accountStatus.transactionsNew">({{ accountStatus.transactionsNew }} new)</template>
                <template v-if="accountStatus.durationMs"> &mdash; {{ formatDuration(accountStatus.durationMs) }}</template>
              </template>
              <template v-else-if="accountStatus.status === 'error'">
                <span class="text-red-500">{{ accountStatus.error ?? 'Failed' }}</span>
                <template v-if="accountStatus.durationMs"> &mdash; {{ formatDuration(accountStatus.durationMs) }}</template>
              </template>
            </span>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Loading skeleton -->
    <div v-if="loading" class="space-y-3">
      <Skeleton class="h-20 w-full" />
      <Skeleton class="h-20 w-full" />
      <Skeleton class="h-20 w-full" />
    </div>

    <!-- Session History -->
    <div v-else class="space-y-2">
      <h2 class="text-lg font-medium">Session History</h2>
      <p v-if="sessions.length === 0" class="text-sm text-muted-foreground py-8 text-center">
        No scrape sessions yet. Trigger a scrape to get started.
      </p>
      <div v-else class="space-y-1">
        <div
          v-for="session in sessions"
          :key="session.id"
          class="border rounded-lg"
        >
          <!-- Session header row (clickable) -->
          <button
            class="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent/50 transition-colors text-left"
            @click="toggleExpand(session.id)"
          >
            <ChevronDown
              v-if="expandedSessions.has(session.id)"
              class="h-4 w-4 flex-shrink-0 text-muted-foreground"
            />
            <ChevronRight
              v-else
              class="h-4 w-4 flex-shrink-0 text-muted-foreground"
            />

            <span class="text-muted-foreground w-8 text-right">#{{ session.id }}</span>
            <span class="w-36">{{ formatDateTime(session.startedAt) }}</span>
            <Badge :variant="statusVariant(session.status)" class="w-20 justify-center">
              {{ session.status }}
            </Badge>
            <Badge variant="outline">{{ triggerLabel(session.trigger) }}</Badge>
            <span class="truncate text-muted-foreground">{{ sessionAccountNames(session) }}</span>
            <span class="flex-shrink-0 text-muted-foreground ml-auto">{{ sessionSummary(session) }}</span>
          </button>

          <!-- Expanded per-account logs -->
          <div
            v-if="expandedSessions.has(session.id) && session.logs.length > 0"
            class="border-t px-4 py-2 bg-muted/30"
          >
            <div
              v-for="log in session.logs"
              :key="log.id"
              class="flex items-center gap-3 py-1.5 text-sm"
            >
              <CheckCircle2
                v-if="log.status === 'success'"
                class="h-4 w-4 text-green-500 flex-shrink-0"
              />
              <XCircle
                v-else
                class="h-4 w-4 text-red-500 flex-shrink-0"
              />
              <span class="w-40 truncate font-medium">{{ log.accountName }}</span>
              <span v-if="log.status === 'success'" class="text-muted-foreground">
                {{ log.transactionsFound }} txns ({{ log.transactionsNew ?? 0 }} new)
              </span>
              <span v-else class="text-red-500 truncate">
                {{ log.errorMessage ?? log.errorType ?? 'Error' }}
              </span>
              <span v-if="log.durationMs" class="text-muted-foreground ml-auto">
                {{ formatDuration(log.durationMs) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- OTP Dialog -->
    <Dialog v-model:open="otpDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>OTP Required — {{ otpAccountName }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-4 py-2">
          <p class="text-sm text-muted-foreground">Enter the OTP code sent to your device.</p>
          <Input
            v-model="otpCode"
            placeholder="Enter OTP code"
            @keyup.enter="handleOtpSubmit"
          />
        </div>
        <DialogFooter>
          <Button @click="handleOtpSubmit" :disabled="otpSubmitting || !otpCode">
            <Loader2 v-if="otpSubmitting" class="mr-2 h-4 w-4 animate-spin" />
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Manual Login Dialog -->
    <Dialog v-model:open="manualLoginDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manual Login — {{ manualLoginAccountName }}</DialogTitle>
        </DialogHeader>
        <div class="py-2">
          <p class="text-sm text-muted-foreground">
            A browser window should be open. Complete the login process there, then click "Done" below.
          </p>
        </div>
        <DialogFooter>
          <Button @click="handleManualLoginConfirm" :disabled="manualLoginSubmitting">
            <Loader2 v-if="manualLoginSubmitting" class="mr-2 h-4 w-4 animate-spin" />
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
