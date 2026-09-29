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
  Landmark,
  CreditCard,
} from 'lucide-vue-next';
import { language } from '@/lib/language';

const copy = computed(() =>
  language.value === 'he'
    ? {
        intro: 'כל החשבונות והעדכונים שלהם במקום אחד.',
        syncAll: 'סנכרון כל החשבונות',
        syncing: 'מתחיל סנכרון…',
        accounts: 'חשבונות מחוברים',
        active: 'פעילים',
        lastSync: 'סנכרון אחרון',
        neverSynced: 'טרם סונכרן',
        syncAccount: 'סנכרון חשבון',
        bank: 'בנק',
        card: 'כרטיס אשראי',
        history: 'סנכרונים אחרונים',
        showAll: 'הצגת כל הסנכרונים',
        showLess: 'הצגת פחות',
        noHistory: 'אין סנכרונים עדיין',
        noHistoryHint: 'סנכרנו חשבון כדי לראות כאן את העדכונים. פרטי הגישה נשארים ב־Mac הזה.',
        noAccounts: 'אין חשבונות פעילים לסנכרון.',
        running: 'סנכרון מתבצע',
        cancel: 'ביטול',
        queued: 'ממתין',
        scraping: 'מסנכרן…',
        done: 'הושלם',
        failed: 'נכשל',
        newItems: 'חדשות',
        transactions: 'עסקאות',
        scheduled: 'אוטומטי',
        single: 'חשבון בודד',
        manual: 'ידני',
        results: 'אין תוצאות',
        succeededCount: 'הצליחו',
        succeededOne: 'הצליח',
        failedCount: 'נכשלו',
        failedOne: 'נכשל',
        statusCompleted: 'הושלם',
        statusError: 'שגיאה',
        statusCancelled: 'בוטל',
      }
    : {
        intro: 'Every connected account and its latest update, in one place.',
        syncAll: 'Sync all accounts',
        syncing: 'Starting sync…',
        accounts: 'Connected accounts',
        active: 'active',
        lastSync: 'Last synced',
        neverSynced: 'Not synced yet',
        syncAccount: 'Sync account',
        bank: 'Bank',
        card: 'Credit card',
        history: 'Recent syncs',
        showAll: 'Show all syncs',
        showLess: 'Show fewer',
        noHistory: 'No syncs yet',
        noHistoryHint: 'Sync an account to see updates here. Credentials stay on this Mac.',
        noAccounts: 'No active accounts to sync.',
        running: 'Sync in progress',
        cancel: 'Cancel',
        queued: 'Queued',
        scraping: 'Syncing…',
        done: 'Done',
        failed: 'Failed',
        newItems: 'new',
        transactions: 'transactions',
        scheduled: 'Scheduled',
        single: 'Single account',
        manual: 'Manual',
        results: 'No results',
        succeededCount: 'succeeded',
        succeededOne: 'succeeded',
        failedCount: 'failed',
        failedOne: 'failed',
        statusCompleted: 'Completed',
        statusError: 'Error',
        statusCancelled: 'Cancelled',
      },
);

// ─── State ───
const accounts = ref<Account[]>([]);
const sessions = ref<ScrapeSession[]>([]);
const loading = ref(true);
const triggerLoading = ref(false);
const expandedSessions = ref<Set<number>>(new Set());
const showAllSessions = ref(false);

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
  return accounts.value.find((a) => a.id === id)?.displayName ?? `Account #${id}`;
}

function formatSyncTime(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat(language.value === 'he' ? 'he-IL' : 'en-US', {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
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
  if (trigger === 'scheduled') return copy.value.scheduled;
  if (trigger === 'single') return copy.value.single;
  return copy.value.manual;
}

function statusLabel(status: string): string {
  if (status === 'completed' || status === 'success') return copy.value.statusCompleted;
  if (status === 'error') return copy.value.statusError;
  if (status === 'cancelled') return copy.value.statusCancelled;
  return copy.value.running;
}

function sessionAccountNames(session: ScrapeSession): string {
  const logs = session.logs ?? [];
  if (logs.length === 0) return '';
  const names = [...new Set(logs.map((l) => l.accountName))];
  return names.join(', ');
}

function sessionSummary(session: ScrapeSession): string {
  const logs = session.logs ?? [];
  if (logs.length === 0) return copy.value.results;
  const ok = logs.filter((l) => l.status === 'success').length;
  const fail = logs.filter((l) => l.status === 'error').length;
  const totalFound = logs.reduce((sum, l) => sum + (l.transactionsFound ?? 0), 0);
  const totalNew = logs.reduce((sum, l) => sum + (l.transactionsNew ?? 0), 0);
  const parts: string[] = [];
  if (ok > 0) parts.push(`${ok} ${ok === 1 ? copy.value.succeededOne : copy.value.succeededCount}`);
  if (fail > 0) parts.push(`${fail} ${fail === 1 ? copy.value.failedOne : copy.value.failedCount}`);
  parts.push(`${totalFound} ${copy.value.transactions}`);
  if (totalNew > 0) parts.push(`${totalNew} ${copy.value.newItems}`);
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
  elapsedTimer = setInterval(() => {
    elapsedSeconds.value++;
  }, 1000);
}

function stopElapsedTimer() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
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
    getScrapeSessions({ limit: 50 }).then((res) => {
      sessions.value = res.sessions;
    });
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
  connectSse();
});

onUnmounted(() => {
  stopElapsedTimer();
});

const activeAccounts = computed(() => accounts.value.filter((a) => a.isActive));
const visibleSessions = computed(() =>
  showAllSessions.value ? sessions.value : sessions.value.slice(0, 8),
);
const latestSession = computed(() => sessions.value[0]);
</script>

<template>
  <div class="sync-page animate-fade-in-up">
    <Teleport to="#toolbar-actions">
      <Button
        size="sm"
        :disabled="triggerLoading || !!liveSession || loading || !activeAccounts.length"
        @click="handleScrapeAll"
      >
        <Loader2 v-if="triggerLoading" class="h-4 w-4 animate-spin" />
        <Play v-else class="h-4 w-4" />
        {{ triggerLoading ? copy.syncing : copy.syncAll }}
      </Button>
    </Teleport>

    <div class="sync-overview">
      <p>{{ copy.intro }}</p>
      <div v-if="latestSession" class="sync-latest">
        <span class="sync-status-dot" :class="latestSession.status" />
        <span>{{ copy.lastSync }}</span>
        <strong>{{ formatSyncTime(latestSession.startedAt) }}</strong>
        <span>· {{ statusLabel(latestSession.status) }}</span>
      </div>
    </div>

    <div v-if="errorMessage" role="alert" class="sync-error">
      <XCircle class="h-4 w-4 shrink-0" />
      <span>{{ errorMessage }}</span>
      <button type="button" :aria-label="copy.cancel" @click="errorMessage = null">×</button>
    </div>

    <section v-if="liveSession" class="sync-running" aria-live="polite">
      <div class="sync-section-heading">
        <h2><Loader2 class="h-4 w-4 animate-spin" />{{ copy.running }}</h2>
        <div class="sync-running-actions">
          <span><Clock class="h-4 w-4" />{{ elapsedSeconds }}s</span>
          <Button variant="secondary" size="sm" @click="handleCancel">
            <Square class="h-3.5 w-3.5" />{{ copy.cancel }}
          </Button>
        </div>
      </div>
      <div class="sync-live-accounts">
        <div v-for="accountStatus in liveSession.accounts" :key="accountStatus.accountId">
          <Loader2
            v-if="accountStatus.status === 'scraping'"
            class="h-4 w-4 animate-spin text-primary"
          />
          <CheckCircle2 v-else-if="accountStatus.status === 'done'" class="h-4 w-4 text-success" />
          <XCircle v-else-if="accountStatus.status === 'error'" class="h-4 w-4 text-destructive" />
          <Clock v-else class="h-4 w-4 text-text-tertiary" />
          <strong>{{ getAccountName(accountStatus.accountId) }}</strong>
          <span v-if="accountStatus.status === 'done'">
            {{ accountStatus.transactionsFound ?? 0 }} {{ copy.transactions }}
            <template v-if="accountStatus.transactionsNew"
              >· {{ accountStatus.transactionsNew }} {{ copy.newItems }}</template
            >
          </span>
          <span v-else-if="accountStatus.status === 'error'" class="text-destructive">{{
            accountStatus.error ?? copy.failed
          }}</span>
          <span v-else>{{ accountStatus.status === 'queued' ? copy.queued : copy.scraping }}</span>
        </div>
      </div>
    </section>

    <section class="sync-section">
      <div class="sync-section-heading">
        <h2>{{ copy.accounts }}</h2>
        <span class="sync-count">{{ activeAccounts.length }} {{ copy.active }}</span>
      </div>
      <div v-if="loading" class="sync-skeleton">
        <Skeleton v-for="i in 3" :key="i" class="h-16 w-full" />
      </div>
      <p v-else-if="!activeAccounts.length" class="sync-empty-inline">{{ copy.noAccounts }}</p>
      <div v-else class="sync-account-list">
        <div v-for="account in activeAccounts" :key="account.id" class="sync-account-row">
          <div class="sync-account-identity">
            <span class="sync-account-icon">
              <Landmark v-if="account.accountType === 'bank'" :size="18" />
              <CreditCard v-else :size="18" />
            </span>
            <span class="sync-account-name">
              <strong>{{ account.displayName }}</strong>
              <small>{{ account.accountType === 'bank' ? copy.bank : copy.card }}</small>
            </span>
          </div>
          <span class="sync-account-updated">
            {{ account.lastScrapedAt ? formatSyncTime(account.lastScrapedAt) : copy.neverSynced }}
          </span>
          <Button
            variant="secondary"
            size="sm"
            :aria-label="`${copy.syncAccount}: ${account.displayName}`"
            :disabled="triggerLoading || !!liveSession"
            @click="handleScrapeAccount(account.id)"
          >
            <Play class="h-3.5 w-3.5" />{{ copy.syncAccount }}
          </Button>
        </div>
      </div>
    </section>

    <section class="sync-section sync-history">
      <div class="sync-section-heading">
        <h2>{{ copy.history }}</h2>
        <button
          v-if="sessions.length > 8"
          type="button"
          class="sync-show-more"
          @click="showAllSessions = !showAllSessions"
        >
          {{ showAllSessions ? copy.showLess : copy.showAll }}
        </button>
      </div>
      <div v-if="loading" class="sync-skeleton">
        <Skeleton v-for="i in 3" :key="i" class="h-16 w-full" />
      </div>
      <div v-else-if="!sessions.length" class="scrape-empty">
        <Landmark :size="28" :stroke-width="1.6" />
        <h3>{{ copy.noHistory }}</h3>
        <p>{{ copy.noHistoryHint }}</p>
      </div>
      <div v-else class="sync-session-list">
        <div v-for="session in visibleSessions" :key="session.id" class="sync-session">
          <button
            type="button"
            class="sync-session-button"
            :aria-expanded="expandedSessions.has(session.id)"
            @click="toggleExpand(session.id)"
          >
            <span class="sync-status-icon" :class="session.status">
              <CheckCircle2 v-if="session.status === 'completed'" :size="17" />
              <XCircle v-else-if="session.status === 'error'" :size="17" />
              <Loader2 v-else-if="session.status === 'running'" :size="17" class="animate-spin" />
              <Clock v-else :size="17" />
            </span>
            <span class="sync-session-main">
              <strong
                >{{ triggerLabel(session.trigger) }} · {{ statusLabel(session.status) }}</strong
              >
              <small>{{ sessionAccountNames(session) || copy.results }}</small>
            </span>
            <span class="sync-session-result">{{ sessionSummary(session) }}</span>
            <time class="sync-session-time">{{ formatSyncTime(session.startedAt) }}</time>
            <ChevronDown
              :size="17"
              class="sync-session-chevron"
              :class="{ open: expandedSessions.has(session.id) }"
            />
          </button>
          <div
            v-if="expandedSessions.has(session.id) && session.logs.length"
            class="sync-session-logs"
          >
            <div v-for="log in session.logs" :key="log.id">
              <CheckCircle2 v-if="log.status === 'success'" :size="16" class="text-success" />
              <XCircle v-else :size="16" class="text-destructive" />
              <strong>{{ log.accountName }}</strong>
              <span v-if="log.status === 'success'"
                >{{ log.transactionsFound }} {{ copy.transactions }} ·
                {{ log.transactionsNew ?? 0 }} {{ copy.newItems }}</span
              >
              <span v-else class="text-destructive">{{
                log.errorMessage ?? log.errorType ?? copy.failed
              }}</span>
              <small v-if="log.durationMs">{{ formatDuration(log.durationMs) }}</small>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- OTP Dialog -->
    <Dialog v-model:open="otpDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>OTP Required — {{ otpAccountName }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-4 py-2">
          <p class="text-[13px] text-text-secondary">Enter the OTP code sent to your device.</p>
          <Input v-model="otpCode" placeholder="Enter OTP code" @keyup.enter="handleOtpSubmit" />
        </div>
        <DialogFooter>
          <Button variant="filled" :disabled="otpSubmitting || !otpCode" @click="handleOtpSubmit">
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
            A browser window should be open. Complete the login process there, then click "Done"
            below.
          </p>
        </div>
        <DialogFooter>
          <Button
            variant="filled"
            :disabled="manualLoginSubmitting"
            @click="handleManualLoginConfirm"
          >
            <Loader2 v-if="manualLoginSubmitting" class="mr-2 h-4 w-4 animate-spin" />
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
