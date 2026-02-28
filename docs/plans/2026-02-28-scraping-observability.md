# Scraping Observability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a scraping management page with live session tracking, session history, background scrape execution, and cancel support.

**Architecture:** Introduce a `scrapeSessions` table grouping per-account scrape logs into sessions. Scrapes run as background promises (fire-and-forget from HTTP handlers). The frontend connects via existing SSE for live updates and renders a new `/scraping` route.

**Tech Stack:** Fastify + Drizzle ORM + SQLite (backend), Vue 3 + Reka UI + Tailwind CSS (frontend), SSE for real-time.

---

### Task 1: Database Schema — Add `scrapeSessions` table and update `scrapeLogs`

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/shared/types.ts`

**Step 1: Add `scrapeSessions` table and update `scrapeLogs` in schema**

In `src/db/schema.ts`, add the new table after `scrapeLogs` and add columns to `scrapeLogs`:

```typescript
export const scrapeSessions = sqliteTable('scrape_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  trigger: text('trigger').notNull(), // 'manual' | 'scheduled' | 'single'
  status: text('status').notNull().default('running'), // 'running' | 'completed' | 'cancelled' | 'error'
  accountIds: text('account_ids').notNull(), // JSON array of target account IDs
  startedAt: text('started_at').notNull().default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
});
```

Add to `scrapeLogs`:
- `sessionId` column: `integer('session_id').references(() => scrapeSessions.id)`
- `transactionsNew` column: `integer('transactions_new').default(0)`
- `durationMs` column: `integer('duration_ms')`

**Step 2: Add types in `src/shared/types.ts`**

Add after existing ScrapeLog types:

```typescript
export type ScrapeSession = InferSelectModel<typeof scrapeSessions>;
export type NewScrapeSession = InferInsertModel<typeof scrapeSessions>;
```

Update imports at top to include `scrapeSessions`.

**Step 3: Generate migration**

Run: `npx drizzle-kit generate`

This will generate a new migration file `0005_*.sql` in `src/db/migrations/`. Verify it contains:
1. `CREATE TABLE scrape_sessions` with all columns
2. `ALTER TABLE scrape_logs ADD COLUMN session_id` (nullable integer, FK)
3. `ALTER TABLE scrape_logs ADD COLUMN transactions_new` (integer default 0)
4. `ALTER TABLE scrape_logs ADD COLUMN duration_ms` (integer, nullable)

**Step 4: Commit**

```
feat: add scrape_sessions table and extend scrape_logs schema
```

---

### Task 2: Backend — Session Manager Module

**Files:**
- Create: `src/scraper/session-manager.ts`

**Step 1: Create the session manager**

This module manages active scrape sessions in memory and provides the cancel mechanism.

```typescript
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { scrapeSessions } from '../db/schema.js';
import type { ScrapeSession } from '../shared/types.js';

interface ActiveSession {
  session: ScrapeSession;
  abortController: AbortController;
  /** Promise that resolves when the session completes */
  promise: Promise<void>;
}

const activeSessions = new Map<number, ActiveSession>();

export function getActiveSessions(): ActiveSession[] {
  return Array.from(activeSessions.values());
}

export function getActiveSession(sessionId: number): ActiveSession | undefined {
  return activeSessions.get(sessionId);
}

export function createSession(trigger: 'manual' | 'scheduled' | 'single', accountIds: number[]): { session: ScrapeSession; abortController: AbortController } {
  const session = db.insert(scrapeSessions).values({
    trigger,
    status: 'running',
    accountIds: JSON.stringify(accountIds),
    startedAt: new Date().toISOString(),
  }).returning().get();

  const abortController = new AbortController();
  return { session, abortController };
}

export function registerActiveSession(session: ScrapeSession, abortController: AbortController, promise: Promise<void>): void {
  activeSessions.set(session.id, { session, abortController, promise });
}

export function completeSession(sessionId: number, status: 'completed' | 'error'): void {
  db.update(scrapeSessions)
    .set({ status, completedAt: new Date().toISOString() })
    .where(eq(scrapeSessions.id, sessionId))
    .run();
  activeSessions.delete(sessionId);
}

export function cancelSession(sessionId: number): boolean {
  const active = activeSessions.get(sessionId);
  if (!active) return false;

  active.abortController.abort();
  db.update(scrapeSessions)
    .set({ status: 'cancelled', completedAt: new Date().toISOString() })
    .where(eq(scrapeSessions.id, sessionId))
    .run();
  activeSessions.delete(sessionId);
  return true;
}

export function hasActiveSessions(): boolean {
  return activeSessions.size > 0;
}
```

**Step 2: Commit**

```
feat: add session manager for tracking active scrape sessions
```

---

### Task 3: Backend — Update SSE Event Types

**Files:**
- Modify: `src/api/sse.ts`

**Step 1: Extend SSE event types**

Replace the `SseEventType` and `SseEvent` types:

```typescript
export type SseEventType =
  | 'connected'
  | 'otp-required'
  | 'manual-action-required'
  | 'session-started'
  | 'session-completed'
  | 'account-scrape-started'
  | 'account-scrape-done'
  | 'account-scrape-error';

export interface SseEvent {
  type: SseEventType;
  sessionId?: number;
  accountId?: number;
  accountIds?: number[];
  trigger?: string;
  message?: string;
  transactionsFound?: number;
  transactionsNew?: number;
  durationMs?: number;
  error?: string;
  errorType?: string;
  status?: string;
}
```

The `broadcastSseEvent` function stays the same — it just serializes whatever event is passed.

**Step 2: Commit**

```
feat: extend SSE event types for session-based scraping
```

---

### Task 4: Backend — Refactor `scraper.service.ts` for Sessions

**Files:**
- Modify: `src/scraper/scraper.service.ts`

**Step 1: Update `scrapeAccount` to accept sessionId and signal**

Add `sessionId` and `signal` (AbortSignal) parameters. Write `sessionId` into scrape logs. Compute and store `durationMs` and `transactionsNew`.

Key changes to `scrapeAccount`:
1. Change signature: `scrapeAccount(account: Account, sessionId?: number, signal?: AbortSignal): Promise<ScrapeResult>`
2. At the start, check `signal?.aborted` and bail early
3. When inserting into `scrapeLogs`, include `sessionId`, `transactionsNew`, and `durationMs`
4. Before the `scraper.scrape()` call, check abort signal. The `israeli-bank-scrapers` `createScraper` doesn't support AbortSignal directly, but we can check at key points and throw if aborted.

The `ScrapeResult` interface already has what we need. Add `durationMs` and `transactionsNew` to it:

```typescript
export interface ScrapeResult {
  success: boolean;
  accountId: number;
  transactionsFound: number;
  transactionsNew: number;
  durationMs: number;
  error?: string;
  errorType?: string;
}
```

In the scrape logic, compute duration:

```typescript
const startMs = Date.now();
// ... scraping logic ...
const durationMs = Date.now() - startMs;
```

When inserting scrapeLogs, add:

```typescript
db.insert(scrapeLogs).values({
  accountId: account.id,
  sessionId: sessionId ?? null,
  status: 'success',
  transactionsFound: totalFound,
  transactionsNew: totalNew,
  durationMs,
  startedAt,
  completedAt: new Date().toISOString(),
}).run();
```

**Step 2: Update `scrapeAllAccounts` to accept sessionId and signal**

Change signature: `scrapeAllAccounts(sessionId?: number, signal?: AbortSignal): Promise<ScrapeResult[]>`

Before each account scrape in the loop, check `signal?.aborted`:

```typescript
for (const account of uniqueAccounts) {
  if (signal?.aborted) break;
  const result = await scrapeAccount(account, sessionId, signal);
  results.push(result);
}
```

**Step 3: Commit**

```
feat: thread sessionId and abort signal through scrape functions
```

---

### Task 5: Backend — Refactor Scrape Routes for Background Execution

**Files:**
- Modify: `src/api/scrape.routes.ts`
- Modify: `src/api/validation.ts`

**Step 1: Add validation schemas**

In `src/api/validation.ts`, add:

```typescript
export const scrapeSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
```

**Step 2: Rewrite scrape routes**

Replace the `activeScrapes` Set approach with session-based background execution. Key changes:

**POST `/api/scrape/:accountId`** — fire-and-forget:
```typescript
app.post<{ Params: { accountId: string } }>('/api/scrape/:accountId', async (request, reply) => {
  const accountId = parseInt(request.params.accountId, 10);
  if (isNaN(accountId)) return reply.status(400).send({ error: 'Invalid account ID' });

  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) return reply.status(404).send({ error: 'Account not found' });

  if (hasActiveSessions()) {
    return reply.status(429).send({ error: 'A scrape is already in progress' });
  }

  const { session, abortController } = createSession('single', [accountId]);

  broadcastSseEvent({ type: 'session-started', sessionId: session.id, accountIds: [accountId], trigger: 'single' });
  broadcastSseEvent({ type: 'account-scrape-started', sessionId: session.id, accountId });

  const promise = scrapeAccount(account, session.id, abortController.signal)
    .then((result) => {
      const eventType = result.success ? 'account-scrape-done' : 'account-scrape-error';
      broadcastSseEvent({
        type: eventType,
        sessionId: session.id,
        accountId,
        transactionsFound: result.transactionsFound,
        transactionsNew: result.transactionsNew,
        durationMs: result.durationMs,
        error: result.error,
        errorType: result.errorType,
      });
      completeSession(session.id, result.success ? 'completed' : 'error');
      broadcastSseEvent({ type: 'session-completed', sessionId: session.id, status: result.success ? 'completed' : 'error' });
    })
    .catch((err) => {
      completeSession(session.id, 'error');
      broadcastSseEvent({ type: 'session-completed', sessionId: session.id, status: 'error' });
    });

  registerActiveSession(session, abortController, promise);
  return reply.status(202).send({ sessionId: session.id });
});
```

**POST `/api/scrape/all`** — fire-and-forget:
```typescript
app.post('/api/scrape/all', async (_request, reply) => {
  if (hasActiveSessions()) {
    return reply.status(429).send({ error: 'A scrape is already in progress' });
  }

  const activeAccounts = db.select().from(accounts).where(eq(accounts.isActive, true)).all();
  // Deduplicate by credentialsRef
  const seen = new Set<string>();
  const uniqueAccounts: Account[] = [];
  for (const account of activeAccounts) {
    if (!seen.has(account.credentialsRef)) {
      seen.add(account.credentialsRef);
      uniqueAccounts.push(account);
    }
  }

  const accountIds = uniqueAccounts.map(a => a.id);
  const { session, abortController } = createSession('manual', accountIds);

  broadcastSseEvent({ type: 'session-started', sessionId: session.id, accountIds, trigger: 'manual' });

  const promise = (async () => {
    let hasError = false;
    for (const account of uniqueAccounts) {
      if (abortController.signal.aborted) break;
      broadcastSseEvent({ type: 'account-scrape-started', sessionId: session.id, accountId: account.id });
      const result = await scrapeAccount(account, session.id, abortController.signal);
      if (!result.success) hasError = true;
      broadcastSseEvent({
        type: result.success ? 'account-scrape-done' : 'account-scrape-error',
        sessionId: session.id,
        accountId: account.id,
        transactionsFound: result.transactionsFound,
        transactionsNew: result.transactionsNew,
        durationMs: result.durationMs,
        error: result.error,
        errorType: result.errorType,
      });
    }
    const finalStatus = abortController.signal.aborted ? 'cancelled' : hasError ? 'error' : 'completed';
    completeSession(session.id, finalStatus as 'completed' | 'error');
    broadcastSseEvent({ type: 'session-completed', sessionId: session.id, status: finalStatus });
  })();

  registerActiveSession(session, abortController, promise);
  return reply.status(202).send({ sessionId: session.id });
});
```

**POST `/api/scrape/cancel/:sessionId`** — new endpoint:
```typescript
app.post<{ Params: { sessionId: string } }>('/api/scrape/cancel/:sessionId', async (request, reply) => {
  const sessionId = parseInt(request.params.sessionId, 10);
  if (isNaN(sessionId)) return reply.status(400).send({ error: 'Invalid session ID' });

  const cancelled = cancelSession(sessionId);
  if (!cancelled) return reply.status(404).send({ error: 'No active session found' });

  broadcastSseEvent({ type: 'session-completed', sessionId, status: 'cancelled' });
  return reply.send({ success: true });
});
```

**GET `/api/scrape/sessions`** — list sessions:
```typescript
app.get('/api/scrape/sessions', async (request, reply) => {
  const parsed = scrapeSessionsQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
  }
  const { limit, offset } = parsed.data;

  const sessions = db.select().from(scrapeSessions)
    .orderBy(desc(scrapeSessions.startedAt))
    .limit(limit)
    .offset(offset)
    .all();

  // For each session, get its scrape logs
  const sessionsWithLogs = sessions.map(session => {
    const logs = db.select().from(scrapeLogs)
      .where(eq(scrapeLogs.sessionId, session.id))
      .all();

    // Join account displayName onto each log
    const logsWithNames = logs.map(log => {
      const account = db.select({ displayName: accounts.displayName, companyId: accounts.companyId })
        .from(accounts)
        .where(eq(accounts.id, log.accountId))
        .get();
      return { ...log, accountName: account?.displayName ?? 'Unknown', companyId: account?.companyId ?? '' };
    });

    return { ...session, logs: logsWithNames };
  });

  // Also include any active sessions from memory that might be in "running" state
  const activeSessionsList = getActiveSessions().map(a => ({
    ...a.session,
    logs: [],
  }));

  return reply.send({ sessions: sessionsWithLogs, activeSessions: activeSessionsList });
});
```

**GET `/api/scrape/sessions/:id`** — single session detail:
```typescript
app.get<{ Params: { id: string } }>('/api/scrape/sessions/:id', async (request, reply) => {
  const id = parseInt(request.params.id, 10);
  if (isNaN(id)) return reply.status(400).send({ error: 'Invalid session ID' });

  const session = db.select().from(scrapeSessions).where(eq(scrapeSessions.id, id)).get();
  if (!session) return reply.status(404).send({ error: 'Session not found' });

  const logs = db.select().from(scrapeLogs)
    .where(eq(scrapeLogs.sessionId, id))
    .all();

  const logsWithNames = logs.map(log => {
    const account = db.select({ displayName: accounts.displayName, companyId: accounts.companyId })
      .from(accounts)
      .where(eq(accounts.id, log.accountId))
      .get();
    return { ...log, accountName: account?.displayName ?? 'Unknown', companyId: account?.companyId ?? '' };
  });

  return reply.send({ session: { ...session, logs: logsWithNames } });
});
```

Remember to add the new imports at the top of `scrape.routes.ts`:
```typescript
import { scrapeSessions, scrapeLogs } from '../db/schema.js';
import { createSession, registerActiveSession, completeSession, cancelSession, hasActiveSessions, getActiveSessions } from '../scraper/session-manager.js';
import type { Account } from '../shared/types.js';
```

**Step 3: Commit**

```
feat: background scrape execution with sessions and cancel support
```

---

### Task 6: Backend — Update Scheduler to Create Sessions

**Files:**
- Modify: `src/scraper/scheduler.ts`

**Step 1: Update scheduler to use sessions**

The scheduler should create a session with trigger `scheduled` and broadcast SSE events.

```typescript
import cron, { type ScheduledTask } from 'node-cron';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/connection.js';
import { accounts } from '../db/schema.js';
import { scrapeAccount } from './scraper.service.js';
import { createSession, registerActiveSession, completeSession, hasActiveSessions } from './session-manager.js';
import { broadcastSseEvent } from '../api/sse.js';
import type { Account } from '../shared/types.js';

let scheduledTask: ScheduledTask | null = null;

export function startScheduler(): void {
  if (scheduledTask) {
    console.log('[Scheduler] Already running, skipping start');
    return;
  }

  const cronExpression = config.SCRAPE_CRON;
  const timezone = config.SCRAPE_TIMEZONE;

  if (!cron.validate(cronExpression)) {
    console.error(`[Scheduler] Invalid cron expression: ${cronExpression}`);
    return;
  }

  console.log(`[Scheduler] Starting with schedule "${cronExpression}" (timezone: ${timezone})`);

  scheduledTask = cron.schedule(cronExpression, async () => {
    console.log(`[Scheduler] Triggered at ${new Date().toISOString()}`);

    if (hasActiveSessions()) {
      console.log('[Scheduler] Skipping — a scrape is already in progress');
      return;
    }

    const activeAccounts = db.select().from(accounts).where(eq(accounts.isActive, true)).all();
    const seen = new Set<string>();
    const uniqueAccounts: Account[] = [];
    for (const account of activeAccounts) {
      if (!seen.has(account.credentialsRef)) {
        seen.add(account.credentialsRef);
        uniqueAccounts.push(account);
      }
    }

    const accountIds = uniqueAccounts.map(a => a.id);
    const { session, abortController } = createSession('scheduled', accountIds);
    broadcastSseEvent({ type: 'session-started', sessionId: session.id, accountIds, trigger: 'scheduled' });

    const promise = (async () => {
      let hasError = false;
      for (const account of uniqueAccounts) {
        if (abortController.signal.aborted) break;
        broadcastSseEvent({ type: 'account-scrape-started', sessionId: session.id, accountId: account.id });
        const result = await scrapeAccount(account, session.id, abortController.signal);
        if (!result.success) hasError = true;
        broadcastSseEvent({
          type: result.success ? 'account-scrape-done' : 'account-scrape-error',
          sessionId: session.id,
          accountId: account.id,
          transactionsFound: result.transactionsFound,
          transactionsNew: result.transactionsNew,
          durationMs: result.durationMs,
          error: result.error,
          errorType: result.errorType,
        });
      }
      const finalStatus = abortController.signal.aborted ? 'cancelled' : hasError ? 'error' : 'completed';
      completeSession(session.id, finalStatus as 'completed' | 'error');
      broadcastSseEvent({ type: 'session-completed', sessionId: session.id, status: finalStatus });
      const successes = uniqueAccounts.length - (hasError ? 1 : 0); // approximate
      console.log(`[Scheduler] Session ${session.id} ${finalStatus}`);
    })();

    registerActiveSession(session, abortController, promise);
  }, { timezone });
}

export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('[Scheduler] Stopped');
  }
}
```

**Step 2: Commit**

```
feat: scheduler creates scrape sessions with SSE events
```

---

### Task 7: Frontend — API Client Updates

**Files:**
- Modify: `dashboard/src/api/client.ts`

**Step 1: Add session-related types and API functions**

Add these types and functions:

```typescript
// ─── Scrape Sessions ───

export interface ScrapeLogEntry {
  id: number;
  accountId: number;
  sessionId: number | null;
  status: string;
  errorType: string | null;
  errorMessage: string | null;
  transactionsFound: number;
  transactionsNew: number | null;
  durationMs: number | null;
  startedAt: string;
  completedAt: string | null;
  accountName: string;
  companyId: string;
}

export interface ScrapeSession {
  id: number;
  trigger: string;
  status: string;
  accountIds: string; // JSON array
  startedAt: string;
  completedAt: string | null;
  logs: ScrapeLogEntry[];
}

export function getScrapeSessions(params: { limit?: number; offset?: number } = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  return request<{ sessions: ScrapeSession[]; activeSessions: ScrapeSession[] }>(`/scrape/sessions?${query}`);
}

export function getScrapeSession(id: number) {
  return request<{ session: ScrapeSession }>(`/scrape/sessions/${id}`);
}

export function cancelScrapeSession(sessionId: number) {
  return request<{ success: boolean }>(`/scrape/cancel/${sessionId}`, { method: 'POST' });
}
```

Also update `triggerScrape` and `triggerScrapeAll` to return sessionId:

```typescript
export function triggerScrape(accountId: number) {
  return request<{ sessionId: number }>(`/scrape/${accountId}`, { method: 'POST' });
}

export function triggerScrapeAll() {
  return request<{ sessionId: number }>('/scrape/all', { method: 'POST' });
}
```

**Step 2: Commit**

```
feat: add scrape session API client functions
```

---

### Task 8: Frontend — Scraping Page Component

**Files:**
- Create: `dashboard/src/components/ScrapingDashboard.vue`
- Modify: `dashboard/src/main.ts` (add route)
- Modify: `dashboard/src/components/AppLayout.vue` (add nav item)

**Step 1: Add route in `dashboard/src/main.ts`**

Add to routes array:

```typescript
{ path: '/scraping', component: () => import('./components/ScrapingDashboard.vue') },
```

**Step 2: Add nav item in `dashboard/src/components/AppLayout.vue`**

Import `Activity` icon from lucide-vue-next, add to navItems array:

```typescript
{ path: '/scraping', label: 'Scraping', icon: Activity },
```

**Step 3: Create ScrapingDashboard.vue**

This is the main component. Structure:

```vue
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
import { PROVIDERS } from '@/lib/providers';
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
  Activity,
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

function getCompanyName(companyId: string): string {
  return PROVIDERS.find(p => p.id === companyId)?.name ?? companyId;
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

function sessionSummary(session: ScrapeSession): string {
  const logs = session.logs ?? [];
  const ok = logs.filter(l => l.status === 'success').length;
  const fail = logs.filter(l => l.status === 'error').length;
  const parts: string[] = [];
  if (ok > 0) parts.push(`${ok} ok`);
  if (fail > 0) parts.push(`${fail} failed`);
  return parts.join(', ') || 'No results';
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
  } catch (err) {
    // SSE will update state
  } finally {
    triggerLoading.value = false;
  }
}

async function handleScrapeAccount(accountId: number) {
  triggerLoading.value = true;
  try {
    await triggerScrape(accountId);
  } catch (err) {
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
        <Select @update:model-value="(v: string) => handleScrapeAccount(Number(v))">
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
            <span class="flex-1 text-muted-foreground text-right">{{ sessionSummary(session) }}</span>
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
                {{ log.transactionsFound }} txns
                <template v-if="log.transactionsNew">({{ log.transactionsNew }} new)</template>
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
```

**Step 4: Commit**

```
feat: add scraping dashboard page with live session tracking
```

---

### Task 9: Verify & Polish

**Step 1: Build and verify**

Run: `cd dashboard && npm run build`

Fix any TypeScript or build errors.

**Step 2: Start the app and manual test**

Run: `npm run dev` (from project root)

Verify:
- `/scraping` route loads correctly
- Nav item appears in sidebar
- "Scrape All" button triggers a background scrape and returns immediately
- Active session banner appears with per-account status
- SSE events update the live view in real-time
- Cancel button works
- After session completes, it appears in session history
- Expanding a session shows per-account details

**Step 3: Commit any fixes**

```
fix: polish scraping dashboard after manual testing
```
