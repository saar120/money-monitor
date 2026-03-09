<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  getAccounts,
  getScrapeSessions,
  triggerScrape,
  triggerScrapeAll,
  cancelScrapeSession,
  type Account,
  type ScrapeSession,
} from '../api/client';
import { useOtpFlow } from '../composables/useOtpFlow';
import { useSseConnection } from '../composables/useSseConnection';
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
import { formatDateTime } from '@/lib/format';

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
  accounts: Record<number, LiveAccountStatus>;
  startedAt: number; // Date.now() timestamp
}

const liveSession = ref<LiveSession | null>(null);
const elapsedSeconds = ref(0);
let elapsedTimer: ReturnType<typeof setInterval> | null = null;
const errorMessage = ref<string | null>(null);

// ─── OTP/Manual login dialogs ───
const {
  otpLabel: otpAccountName,
  otpCode,
  otpSubmitting,
  otpDialogOpen: otpDialog,
  showOtpDialog,
  handleOtpSubmit,
  manualLoginLabel: manualLoginAccountName,
  manualLoginSubmitting,
  manualLoginDialogOpen: manualLoginDialog,
  showManualLoginDialog,
  handleManualLoginConfirm,
} = useOtpFlow();

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

    // If there's an active session running, hydrate the live banner
    const active = sessionsRes.activeSessions[0];
    if (!liveSession.value && active) {
      const parsedIds: number[] = JSON.parse(active.accountIds);
      const accountsMap: Record<number, LiveAccountStatus> = {};
      for (const id of parsedIds) {
        accountsMap[id] = { accountId: id, status: 'scraping' };
      }
      liveSession.value = {
        sessionId: active.id,
        trigger: active.trigger,
        accountIds: parsedIds,
        accounts: accountsMap,
        startedAt: Date.now(),
      };
      startElapsedTimer();
    }
  } finally {
    loading.value = false;
  }
}

// ─── Actions ───
async function handleScrapeAll() {
  triggerLoading.value = true;
  errorMessage.value = null;
  try {
    await triggerScrapeAll();
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'Failed to start scrape';
  } finally {
    triggerLoading.value = false;
  }
}

async function handleScrapeAccount(accountId: number) {
  triggerLoading.value = true;
  errorMessage.value = null;
  try {
    await triggerScrape(accountId);
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'Failed to start scrape';
  } finally {
    triggerLoading.value = false;
  }
}

async function handleCancel() {
  if (!liveSession.value) return;
  try {
    await cancelScrapeSession(liveSession.value.sessionId);
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'Failed to cancel session';
  }
}

// ─── SSE Connection ───
function startElapsedTimer() {
  stopElapsedTimer();
  elapsedSeconds.value = 0;
  elapsedTimer = setInterval(() => { elapsedSeconds.value++; }, 1000);
}

function stopElapsedTimer() {
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
}

const { connect: connectSse } = useSseConnection({
  'session-started': (data) => {
    const accountsMap: Record<number, LiveAccountStatus> = {};
    for (const id of data.accountIds as number[]) {
      accountsMap[id] = { accountId: id, status: 'queued' };
    }
    liveSession.value = {
      sessionId: data.sessionId as number,
      trigger: data.trigger as string,
      accountIds: data.accountIds as number[],
      accounts: accountsMap,
      startedAt: Date.now(),
    };
    startElapsedTimer();
  },
  'account-scrape-started': (data) => {
    if (liveSession.value) {
      liveSession.value.accounts[data.accountId as number] = {
        accountId: data.accountId as number,
        status: 'scraping',
      };
    }
  },
  'account-scrape-done': (data) => {
    if (liveSession.value) {
      liveSession.value.accounts[data.accountId as number] = {
        accountId: data.accountId as number,
        status: 'done',
        transactionsFound: data.transactionsFound as number | undefined,
        transactionsNew: data.transactionsNew as number | undefined,
        durationMs: data.durationMs as number | undefined,
      };
    }
  },
  'account-scrape-error': (data) => {
    if (liveSession.value) {
      liveSession.value.accounts[data.accountId as number] = {
        accountId: data.accountId as number,
        status: 'error',
        error: data.error as string | undefined,
        durationMs: data.durationMs as number | undefined,
      };
    }
  },
  'session-completed': (data) => {
    liveSession.value = null;
    stopElapsedTimer();
    if (data.status === 'error' && data.error) {
      errorMessage.value = `Scrape session failed: ${data.error}`;
    }
    // Reload session history only (accounts don't change during scraping)
    getScrapeSessions({ limit: 50 }).then(res => { sessions.value = res.sessions; });
  },
  'otp-required': (data) => {
    showOtpDialog(data.accountId as number, getAccountName(data.accountId as number));
  },
  'manual-action-required': (data) => {
    showManualLoginDialog(data.accountId as number, getAccountName(data.accountId as number));
  },
});

// ─── Lifecycle ───
onMounted(() => {
  loadData();
  void connectSse();
});

onUnmounted(() => {
  stopElapsedTimer();
});

const activeAccounts = computed(() => accounts.value.filter(a => a.isActive));
</script>

<template>
  <div class="space-y-6 animate-fade-in-up">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-[22px] font-semibold text-text-primary">Scraping</h1>
        <p class="text-[13px] text-text-secondary">Monitor and manage bank scrapes</p>
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

    <!-- Error Banner -->
    <div
      v-if="errorMessage"
      class="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-[13px] text-destructive"
    >
      <XCircle class="h-4 w-4 flex-shrink-0" />
      <span class="flex-1">{{ errorMessage }}</span>
      <button class="text-destructive/70 hover:text-destructive" @click="errorMessage = null">&times;</button>
    </div>

    <!-- Active Session Banner -->
    <Card v-if="liveSession" class="border-primary/30 bg-primary/5">
      <CardHeader class="pb-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <Loader2 class="h-5 w-5 animate-spin text-primary" />
            <CardTitle class="text-[15px]">
              Active Scrape
              <Badge variant="secondary" class="ml-2">{{ triggerLabel(liveSession.trigger) }}</Badge>
            </CardTitle>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-[13px] text-text-secondary">
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
            v-for="accountStatus in liveSession.accounts"
            :key="accountStatus.accountId"
            class="flex items-center gap-3 text-[13px]"
          >
            <!-- Status icon -->
            <Loader2
              v-if="accountStatus.status === 'scraping'"
              class="h-4 w-4 animate-spin text-primary flex-shrink-0"
            />
            <CheckCircle2
              v-else-if="accountStatus.status === 'done'"
              class="h-4 w-4 text-success flex-shrink-0"
            />
            <XCircle
              v-else-if="accountStatus.status === 'error'"
              class="h-4 w-4 text-destructive flex-shrink-0"
            />
            <div
              v-else
              class="h-4 w-4 rounded-full border-2 border-text-secondary/30 flex-shrink-0"
            />

            <!-- Account name -->
            <span class="w-40 truncate font-medium">{{ getAccountName(accountStatus.accountId) }}</span>

            <!-- Status text -->
            <span class="text-text-secondary">
              <template v-if="accountStatus.status === 'queued'">Queued</template>
              <template v-else-if="accountStatus.status === 'scraping'">Scraping...</template>
              <template v-else-if="accountStatus.status === 'done'">
                {{ accountStatus.transactionsFound }} txns
                <template v-if="accountStatus.transactionsNew">({{ accountStatus.transactionsNew }} new)</template>
                <template v-if="accountStatus.durationMs"> &mdash; {{ formatDuration(accountStatus.durationMs) }}</template>
              </template>
              <template v-else-if="accountStatus.status === 'error'">
                <span class="text-destructive">{{ accountStatus.error ?? 'Failed' }}</span>
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
      <h2 class="text-[15px] font-semibold">Session History</h2>
      <p v-if="sessions.length === 0" class="text-[13px] text-text-secondary py-8 text-center">
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
            class="w-full flex items-center gap-3 px-4 py-3 text-[13px] hover:bg-bg-tertiary/50 transition-colors text-left"
            @click="toggleExpand(session.id)"
          >
            <ChevronDown
              v-if="expandedSessions.has(session.id)"
              class="h-4 w-4 flex-shrink-0 text-text-secondary"
            />
            <ChevronRight
              v-else
              class="h-4 w-4 flex-shrink-0 text-text-secondary"
            />

            <span class="text-text-secondary w-8 text-right">#{{ session.id }}</span>
            <span class="w-36">{{ formatDateTime(session.startedAt) }}</span>
            <Badge :variant="statusVariant(session.status)" class="w-20 justify-center">
              {{ session.status }}
            </Badge>
            <Badge variant="outline">{{ triggerLabel(session.trigger) }}</Badge>
            <span class="truncate text-text-secondary">{{ sessionAccountNames(session) }}</span>
            <span class="flex-shrink-0 text-text-secondary ml-auto">{{ sessionSummary(session) }}</span>
          </button>

          <!-- Expanded per-account logs -->
          <div
            v-if="expandedSessions.has(session.id) && session.logs.length > 0"
            class="border-t px-4 py-2 bg-bg-secondary"
          >
            <div
              v-for="log in session.logs"
              :key="log.id"
              class="flex items-center gap-3 py-1.5 text-[13px]"
            >
              <CheckCircle2
                v-if="log.status === 'success'"
                class="h-4 w-4 text-success flex-shrink-0"
              />
              <XCircle
                v-else
                class="h-4 w-4 text-destructive flex-shrink-0"
              />
              <span class="w-40 truncate font-medium">{{ log.accountName }}</span>
              <span v-if="log.status === 'success'" class="text-text-secondary">
                {{ log.transactionsFound }} txns ({{ log.transactionsNew ?? 0 }} new)
              </span>
              <span v-else class="text-destructive truncate">
                {{ log.errorMessage ?? log.errorType ?? 'Error' }}
              </span>
              <span v-if="log.durationMs" class="text-text-secondary ml-auto">
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
          <p class="text-[13px] text-text-secondary">Enter the OTP code sent to your device.</p>
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
          <p class="text-[13px] text-text-secondary">
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
