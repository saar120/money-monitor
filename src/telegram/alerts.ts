import { loadAlertSettings, saveAlertSettings } from './alert-settings.js';
import { detectRecurringTransactions } from '../services/summary.js';
import { getNetWorth } from '../services/net-worth.js';
import { todayInIsrael } from '../shared/dates.js';
import { markdownToTelegramHtml, splitMessage } from './format.js';
import { buildPostScrapeAlertPrompt, buildMonthlySummaryAlertPrompt } from '../ai/prompts.js';
import { runAlertAgent } from '../ai/alert-agent.js';
import { MONTH_NAMES } from './alert-constants.js';
import type { ScrapeResult } from '../scraper/scraper.service.js';

// ── Telegram send helper ──────────────────────────────────────────────────────

let _sendMessage: ((chatId: number, html: string) => Promise<void>) | null = null;

export function registerSendMessage(fn: (chatId: number, html: string) => Promise<void>) {
  _sendMessage = fn;
}

async function sendAlert(chatIds: number[], markdown: string): Promise<void> {
  if (!_sendMessage || chatIds.length === 0) return;
  const html = markdownToTelegramHtml(markdown);
  for (const chatId of chatIds) {
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

// ── Post-Scrape Agent Alert ─────────────────────────────────────────────────

/** Build the seed user message with scrape context for the alert agent. */
function buildPostScrapeUserMessage(scrapeResults: ScrapeResult[]): string {
  const settings = loadAlertSettings();
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

  return `Today is ${today} (Israel timezone). A bank/credit-card scrape just completed.

Scrape results:
- ${totalNew} new transactions found (${totalFound} total scanned)
- Scrape errors: ${errorLines}

Alert thresholds:
- Large charge threshold: ₪${fmt(settings.largeChargeThreshold)}
- Unusual spending threshold: ${settings.unusualSpendingPercent}%

Known recurring charges (already alerted in the past): ${knownStr}
Last known net worth: ${lastNw !== undefined ? `₪${fmt(lastNw)}` : 'not yet recorded'}

Report scrape errors: ${settings.reportScrapeErrors ? 'yes' : 'no'}

Analyze the new data using your tools. Compose a single Telegram message covering anything noteworthy. If nothing is worth alerting about, respond with exactly: [SILENT]`;
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

/** Run all post-scrape alerts. Called after a scrape session completes. */
export async function runPostScrapeAlerts(scrapeResults: ScrapeResult[]): Promise<void> {
  const settings = loadAlertSettings();
  if (!settings.enabled) return;

  const chatIds = getChatIds();
  if (chatIds.length === 0) return;

  try {
    const systemPrompt = buildPostScrapeAlertPrompt();
    const userMessage = buildPostScrapeUserMessage(scrapeResults);
    const message = await runAlertAgent({ systemPrompt, userMessage });

    if (message) {
      await sendAlert(chatIds, message);
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
  const monthLabel = MONTH_NAMES[prevMonth - 1];

  try {
    const systemPrompt = buildMonthlySummaryAlertPrompt();
    const userMessage = `Today is ${today}. Please analyze the finances for ${monthLabel} ${prevYear} and compose the monthly summary.`;
    const message = await runAlertAgent({ systemPrompt, userMessage });

    if (message) {
      await sendAlert(chatIds, message);
    }
  } catch (err) {
    console.error(
      '[Alerts] Monthly summary agent failed:',
      err instanceof Error ? err.message : err,
    );
  }
}
