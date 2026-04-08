import { loadAlertSettings, saveAlertSettings, type AlertSettings } from './alert-settings.js';
import { detectRecurringTransactions } from '../services/summary.js';
import { getNetWorth } from '../services/net-worth.js';
import { todayInIsrael } from '../shared/dates.js';
import { markdownToTelegramHtml, splitMessage } from './format.js';
import {
  buildPostScrapeAlertPrompt,
  buildMonthlySummaryAlertPrompt,
  withMemory,
} from '../ai/prompts.js';
import { runAlertAgent } from '../ai/alert-agent.js';
import type { ScrapeResult } from '../scraper/scraper.service.js';
import { db } from '../db/connection.js';
import { accounts } from '../db/schema.js';
import { and, eq, isNotNull } from 'drizzle-orm';

// ── Telegram send helper ──────────────────────────────────────────────────────

let _sendMessage: ((chatId: number, html: string) => Promise<void>) | null = null;
let _onAlertSent: ((chatId: number, markdown: string, context?: string) => void) | null = null;

export function registerSendMessage(fn: (chatId: number, html: string) => Promise<void>) {
  _sendMessage = fn;
}

export function registerOnAlertSent(
  fn: (chatId: number, markdown: string, context?: string) => void,
) {
  _onAlertSent = fn;
}

async function sendAlert(chatIds: number[], markdown: string, context?: string): Promise<void> {
  if (!_sendMessage || chatIds.length === 0) return;
  const html = markdownToTelegramHtml(markdown);
  for (const chatId of chatIds) {
    _onAlertSent?.(chatId, markdown, context);
    for (const chunk of splitMessage(html)) {
      try {
        await _sendMessage(chatId, chunk);
      } catch (err) {
        console.error(
          `[Alerts] Failed to send to chat ${chatId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
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

export function getStaleManualAccounts(): StaleAccountInfo[] {
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

  const now = new Date();
  const stale: StaleAccountInfo[] = [];

  for (const account of manualAccounts) {
    const threshold = account.stalenessDays!;
    let daysSince: number | null = null;

    if (account.lastScrapedAt) {
      const lastScraped = new Date(account.lastScrapedAt);
      daysSince = Math.floor((now.getTime() - lastScraped.getTime()) / (1000 * 60 * 60 * 24));
    }

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

/** Update internal tracking state after alert agent runs. */
async function updateInternalState(): Promise<void> {
  const settings = loadAlertSettings();

  try {
    const { recurring } = detectRecurringTransactions({ monthsBack: 6, minOccurrences: 2 });
    settings._knownRecurring = recurring.map((r) => r.description);
  } catch {
    // Non-critical — keep existing known list
  }

  try {
    const netWorth = await getNetWorth();
    settings._lastNetWorthTotal = netWorth.total;
  } catch {
    // Non-critical — keep existing value
  }

  saveAlertSettings(settings);
}

/** Send a deterministic test message to verify Telegram delivery works. */
export async function sendTestAlertMessage(): Promise<void> {
  if (!_sendMessage) throw new Error('Telegram bot not initialized');
  const chatIds = getChatIds();
  if (chatIds.length === 0) throw new Error('No Telegram chats registered — message the bot first');
  await sendAlert(chatIds, '**Test alert** — Telegram alerts are working correctly.');
}

/** Run all post-scrape alerts. Called after a scrape session completes. */
export async function runPostScrapeAlerts(scrapeResults: ScrapeResult[]): Promise<void> {
  const settings = loadAlertSettings();
  if (!settings.enabled) return;

  const chatIds = getChatIds();
  if (chatIds.length === 0) return;

  try {
    const systemPrompt = withMemory(buildPostScrapeAlertPrompt());
    const staleAccounts = getStaleManualAccounts();
    const userMessage = buildPostScrapeUserMessage(scrapeResults, settings, staleAccounts);
    const message = await runAlertAgent({ systemPrompt, userMessage });

    if (message) {
      await sendAlert(
        chatIds,
        message,
        'A bank/credit-card scrape just completed and new transactions were found. The following is an automated financial alert.',
      );
    }
  } catch (err) {
    console.error('[Alerts] Post-scrape agent failed:', err instanceof Error ? err.message : err);
  }

  // Always update internal state regardless of agent outcome
  await updateInternalState();
}

// ── Monthly Summary Agent Alert ─────────────────────────────────────────────

export async function sendMonthlySummary(): Promise<void> {
  const settings = loadAlertSettings();
  if (!settings.enabled || !settings.monthlySummary.enabled) return;

  const chatIds = getChatIds();
  if (chatIds.length === 0) return;

  const today = todayInIsrael();
  const [year, month] = today.split('-').map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const monthLabel = new Date(prevYear, prevMonth - 1).toLocaleString('en-US', { month: 'short' });

  try {
    const systemPrompt = withMemory(buildMonthlySummaryAlertPrompt());
    const userMessage = `Today is ${today}. Please analyze the finances for ${monthLabel} ${prevYear} and compose the monthly summary.`;
    const message = await runAlertAgent({ systemPrompt, userMessage });

    if (message) {
      await sendAlert(
        chatIds,
        message,
        'An automated monthly financial summary has been generated.',
      );
    }
  } catch (err) {
    console.error(
      '[Alerts] Monthly summary agent failed:',
      err instanceof Error ? err.message : err,
    );
  }
}
