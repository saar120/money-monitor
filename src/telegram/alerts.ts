import { loadAlertSettings, saveAlertSettings, type AlertSettings } from './alert-settings.js';
import { detectRecurringTransactions } from '../services/summary.js';
import { getNetWorth } from '../services/net-worth.js';
import { todayInIsrael, daysElapsedSince } from '../shared/dates.js';
import { markdownToTelegramHtml } from './format.js';
import {
  buildPostScrapeAlertPrompt,
  buildMonthlySummaryAlertPrompt,
  withMemory,
} from '../ai/prompts.js';
import { runAlertAgent } from '../ai/alert-agent.js';
import type { ScrapeResult } from '../scraper/scraper.service.js';
import { db, isDemoMode } from '../db/connection.js';
import { createHash, randomUUID } from 'node:crypto';
import { resolveSession } from './session-map.js';
import {
  prepareTelegramDelivery,
  setTelegramText,
  deliverTelegram,
  telegramDeliveryState,
  TelegramDeliveryError,
  TelegramRejected,
  type TelegramDelivery,
} from './delivery.js';
import { accounts, alertEvaluations } from '../db/schema.js';
import { and, eq, isNotNull } from 'drizzle-orm';

// ── Telegram send helper ──────────────────────────────────────────────────────

let _sendMessage: ((chatId: number, html: string) => Promise<void>) | null = null;
type AlertIdentity = { operationId: string; sessionId: string };
let _onAlertSent:
  | ((
      chatId: number,
      markdown: string,
      context?: string,
      identity?: AlertIdentity,
    ) => void | Promise<void>)
  | null = null;
export function registerSendMessage(fn: (chatId: number, html: string) => Promise<void>) {
  _sendMessage = fn;
}
export function registerOnAlertSent(fn: NonNullable<typeof _onAlertSent>) {
  _onAlertSent = fn;
}

export async function retryAlertDelivery(value: TelegramDelivery, retryFailed = true) {
  return deliverTelegram(
    value.operationId,
    value.chatId,
    async (chunk) => {
      if (!_sendMessage) throw new TelegramRejected('Telegram bot is unavailable');
      await _sendMessage(value.chatId, chunk.text);
    },
    async (confirmed) => {
      if (!_onAlertSent) throw new Error('Alert context owner unavailable');
      await _onAlertSent(
        confirmed.chatId,
        confirmed.context!.markdown,
        confirmed.context!.seed,
        confirmed,
      );
    },
    retryFailed,
  );
}

async function deliverAlert(
  operationId: string,
  recipients: { chatId: number; sessionId: string }[],
) {
  const states = await Promise.all(
    recipients.map(async ({ chatId, sessionId }) => {
      const value = prepareTelegramDelivery(operationId, chatId, sessionId);
      return telegramDeliveryState(await retryAlertDelivery(value, false));
    }),
  );
  for (const kind of ['unknown', 'failed', 'pending'] as const)
    if (states.includes(kind)) throw new TelegramDeliveryError(kind);
}

// ── Chat ID management ────────────────────────────────────────────────────────

let _getAllChatIds: (() => number[]) | null = null;

export function registerGetChatIds(fn: () => number[]) {
  _getAllChatIds = fn;
}

function getChatIds(): number[] {
  return _getAllChatIds?.() ?? [];
}

// ── Shared helpers ──────────────────────────────────────────────────────────

const fmt = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1000) {
    return n.toLocaleString('en-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  return n.toLocaleString('en-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// ── Stale manual account detection ──────────────────────────────────────────

interface StaleAccountInfo {
  id: number;
  displayName: string;
  daysSinceLastScrape: number | null; // null = never scraped
  stalenessDays: number;
}

function getStaleManualAccounts(): StaleAccountInfo[] {
  const manualAccounts = db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.manualScrapeOnly, true),
        eq(accounts.isActive, true),
        isNotNull(accounts.stalenessDays),
      ),
    )
    .all();

  const stale: StaleAccountInfo[] = [];

  for (const account of manualAccounts) {
    const threshold = account.stalenessDays!;
    const daysSince = account.lastScrapedAt ? daysElapsedSince(account.lastScrapedAt) : null;

    if (daysSince === null || daysSince > threshold) {
      stale.push({
        id: account.id,
        displayName: account.displayName,
        daysSinceLastScrape: daysSince,
        stalenessDays: threshold,
      });
    }
  }

  return stale;
}

// ── Post-Scrape Agent Alert ─────────────────────────────────────────────────

/** Build the seed user message with scrape context for the alert agent. */
function buildPostScrapeUserMessage(
  scrapeResults: ScrapeResult[],
  settings: AlertSettings,
  staleAccounts: StaleAccountInfo[],
): string {
  const today = todayInIsrael();

  const totalNew = scrapeResults.reduce((s, r) => s + r.transactionsNew, 0);
  const totalFound = scrapeResults.reduce((s, r) => s + r.transactionsFound, 0);
  const failures = scrapeResults.filter((r) => !r.success);

  const errorLines =
    failures.length > 0
      ? failures
          .map((f) => `  - Account #${f.accountId}: ${f.error ?? f.errorType ?? 'Unknown error'}`)
          .join('\n')
      : 'none';

  const known = settings._knownRecurring ?? [];
  const knownStr = known.length > 0 ? known.join(', ') : 'none tracked yet';
  const lastNw = settings._lastNetWorthTotal;

  const staleLines =
    staleAccounts.length > 0
      ? staleAccounts
          .map(
            (a) =>
              `  - "${a.displayName}" (id: ${a.id}) — ${a.daysSinceLastScrape === null ? 'never scraped' : `last scraped ${a.daysSinceLastScrape} days ago`} (threshold: ${a.stalenessDays} days)`,
          )
          .join('\n')
      : '';

  return `<scrape-context>
Today is ${today} (Israel timezone). A bank/credit-card scrape just completed.
</scrape-context>

<scrape-results>
- ${totalNew} new transactions found (${totalFound} total scanned)
- Scrape errors: ${errorLines}
</scrape-results>

<alert-thresholds>
- Large charge threshold: ₪${fmt(settings.largeChargeThreshold)}
- Unusual spending threshold: ${settings.unusualSpendingPercent}%
</alert-thresholds>

<known-recurring>
${knownStr}
</known-recurring>

<prior-state>
Last known net worth: ${lastNw !== undefined ? `₪${fmt(lastNw)}` : 'not yet recorded'}
Report scrape errors: ${settings.reportScrapeErrors ? 'yes' : 'no'}
</prior-state>

<stale-manual-accounts>
${staleAccounts.length > 0 ? 'The following accounts are marked "manual scrape only" and have exceeded their staleness threshold:\n' + staleLines + '\nRemind the user to manually scrape these accounts.' : 'none'}
</stale-manual-accounts>

<task>
Analyze the new data using your tools. Compose a single Telegram message covering anything noteworthy. If nothing is worth alerting about, respond with exactly: [SILENT]
</task>`;
}

type Evaluation = {
  state: 'evaluating' | 'ready' | 'silent' | 'failed' | 'interrupted';
  digest: string;
  recipients: { chatId: number; sessionId: string }[];
  baseline?: Pick<AlertSettings, '_knownRecurring' | '_lastNetWorthTotal'>;
};
const activeEvaluations = new Map<string, { digest: string; work: Promise<void> }>();
let analysisTail: Promise<unknown> = Promise.resolve();
let accepting = true;
export function pauseAlertEvaluations() {
  accepting = false;
}
export function resumeAlertEvaluations() {
  accepting = true;
}
export async function drainAlertEvaluations() {
  await Promise.allSettled([...activeEvaluations.values()].map((value) => value.work));
}

// Analysis and baseline changes serialize; delivery has its own per-recipient owner.
function evaluate(
  operationId: string,
  digest: string,
  build: (settings: AlertSettings) => { systemPrompt: string; userMessage: string },
  seed: string,
  trackBaseline: boolean,
): Promise<void> {
  const running = activeEvaluations.get(operationId);
  if (running) {
    if (running.digest !== digest) return Promise.reject(new Error('Alert evaluation ID reused'));
    return running.work;
  }
  if (!accepting)
    return Promise.reject(new TelegramDeliveryError('pending', 'Alert evaluation is stopping'));
  const database = db;
  const check = () => {
    if (db !== database) throw new Error('Retired alert scope');
  };
  const analysis = analysisTail
    .catch(() => {})
    .then(async () => {
      check();
      let row = database
        .select()
        .from(alertEvaluations)
        .where(eq(alertEvaluations.key, operationId))
        .get();
      let evaluation: Evaluation;
      if (row) {
        evaluation = JSON.parse(row.payload) as Evaluation;
        if (evaluation.digest !== digest) throw new Error('Alert evaluation ID reused');
        if (evaluation.state === 'evaluating') {
          evaluation.state = 'interrupted';
          database
            .update(alertEvaluations)
            .set({ payload: JSON.stringify(evaluation) })
            .where(eq(alertEvaluations.id, row.id))
            .run();
        }
        if (evaluation.state === 'failed' || evaluation.state === 'interrupted')
          throw new TelegramDeliveryError('analysis');
      } else {
        const settings = loadAlertSettings();
        const chatIds = getChatIds();
        if (isDemoMode() || !settings.enabled || !chatIds.length) return null;
        evaluation = {
          state: 'evaluating',
          digest,
          recipients: chatIds.map((chatId) => ({ chatId, sessionId: resolveSession(chatId) })),
        };
        row = database
          .insert(alertEvaluations)
          .values({ key: operationId, payload: JSON.stringify(evaluation) })
          .returning()
          .get();
        try {
          const message = await runAlertAgent(build(settings));
          check();
          if (trackBaseline) {
            evaluation.baseline = {};
            try {
              evaluation.baseline._knownRecurring = detectRecurringTransactions({
                monthsBack: 6,
                minOccurrences: 2,
              }).recurring.map((r) => r.description);
            } catch {
              /* Keep prior baseline on unavailable data. */
            }
            try {
              evaluation.baseline._lastNetWorthTotal = (await getNetWorth()).total;
            } catch {
              /* Keep prior baseline. */
            }
            check();
          }
          evaluation.state = message ? 'ready' : 'silent';
          database.transaction(() => {
            if (message)
              for (const { chatId, sessionId } of evaluation.recipients) {
                prepareTelegramDelivery(operationId, chatId, sessionId);
                setTelegramText(operationId, chatId, markdownToTelegramHtml(message), {
                  markdown: message,
                  seed,
                });
              }
            database
              .update(alertEvaluations)
              .set({ payload: JSON.stringify(evaluation) })
              .where(eq(alertEvaluations.id, row!.id))
              .run();
          });
        } catch (error) {
          evaluation.state = 'failed';
          database
            .update(alertEvaluations)
            .set({ payload: JSON.stringify(evaluation) })
            .where(eq(alertEvaluations.id, row.id))
            .run();
          throw new TelegramDeliveryError(
            'analysis',
            error instanceof Error ? error.message : 'Alert analysis failed',
          );
        }
      }
      // Durable intent (or SILENT) precedes the baseline. Replays cannot rewind a newer baseline.
      if (evaluation.baseline) {
        const current = loadAlertSettings();
        if ((current._lastAlertEvaluationId ?? 0) < row.id)
          saveAlertSettings({ ...current, ...evaluation.baseline, _lastAlertEvaluationId: row.id });
      }
      return evaluation;
    });
  analysisTail = analysis;
  const work = analysis
    .then(async (evaluation) => {
      if (evaluation?.state === 'ready') await deliverAlert(operationId, evaluation.recipients);
    })
    .finally(() => {
      if (activeEvaluations.get(operationId)?.work === work) activeEvaluations.delete(operationId);
    });
  activeEvaluations.set(operationId, { digest, work });
  return work;
}

export async function sendTestAlertMessage(): Promise<void> {
  if (!_sendMessage) throw new Error('Telegram bot not initialized');
  const chatIds = getChatIds();
  if (!chatIds.length) throw new Error('No Telegram chats registered — message the bot first');
  const operationId = `test:${randomUUID()}`;
  const recipients = chatIds.map((chatId) => ({ chatId, sessionId: resolveSession(chatId) }));
  for (const { chatId, sessionId } of recipients) {
    prepareTelegramDelivery(operationId, chatId, sessionId);
    setTelegramText(
      operationId,
      chatId,
      markdownToTelegramHtml('**Test alert** — Telegram alerts are working correctly.'),
    );
  }
  await deliverAlert(operationId, recipients);
}

export function runPostScrapeAlerts(
  scrapeResults: ScrapeResult[],
  operationId = `manual:${randomUUID()}`,
): Promise<void> {
  const digest = createHash('sha256').update(JSON.stringify(scrapeResults)).digest('hex');
  return evaluate(
    operationId,
    digest,
    (settings) => ({
      systemPrompt: withMemory(buildPostScrapeAlertPrompt()),
      userMessage: buildPostScrapeUserMessage(scrapeResults, settings, getStaleManualAccounts()),
    }),
    'A bank/credit-card scrape just completed. The following is an automated financial alert.',
    true,
  );
}

export function sendMonthlySummary(): Promise<void> {
  const settings = loadAlertSettings();
  if (!settings.enabled || !settings.monthlySummary.enabled) return Promise.resolve();
  const today = todayInIsrael();
  const [year, month] = today.split('-').map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const period = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
  const label = new Date(prevYear, prevMonth - 1).toLocaleString('en-US', { month: 'short' });
  return evaluate(
    `monthly:${period}`,
    period,
    () => ({
      systemPrompt: withMemory(buildMonthlySummaryAlertPrompt()),
      userMessage: `Today is ${today}. Please analyze the finances for ${label} ${prevYear} and compose the monthly summary.`,
    }),
    'An automated monthly financial summary has been generated.',
    false,
  );
}
