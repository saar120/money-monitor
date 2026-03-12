import { and, eq, gte, lte, sql, inArray } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { transactions, accounts, categories } from '../db/schema.js';
import { loadAlertSettings, saveAlertSettings } from './alert-settings.js';
import {
  detectRecurringTransactions,
  getSpendingSummary,
  comparePeriods,
} from '../services/summary.js';
import { getNetWorth } from '../services/net-worth.js';
import { todayInIsrael } from '../shared/dates.js';
import { markdownToTelegramHtml, splitMessage } from './format.js';
import { MONTH_NAMES, MSG } from './alert-constants.js';
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

/** Get category name → label map from DB. */
function getCategoryLabelMap(): Map<string, string> {
  const rows = db.select({ name: categories.name, label: categories.label }).from(categories).all();
  return new Map(rows.map((c) => [c.name, c.label]));
}

/** Compute month offset from a [year, month] pair. Returns { year, month (1-12), start, end }. */
function monthOffset(baseYear: number, baseMonth: number, offset: number) {
  const d = new Date(baseYear, baseMonth - 1 + offset, 1);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const ms = String(m).padStart(2, '0');
  const lastDay = new Date(y, m, 0).getDate();
  return {
    year: y,
    month: m,
    start: `${y}-${ms}-01`,
    end: `${y}-${ms}-${String(lastDay).padStart(2, '0')}`,
  };
}

/** Yesterday's date in Israel timezone (YYYY-MM-DD). */
function yesterdayInIsrael(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

// ── 1. Post-Scrape Daily Digest ───────────────────────────────────────────────

export async function sendPostScrapeDigest(scrapeResults: ScrapeResult[]): Promise<void> {
  const settings = loadAlertSettings() as any; // TODO: Task 4 will rewrite this function
  if (!settings.enabled || !settings.dailyDigest?.enabled) return;

  const chatIds = getChatIds();
  if (chatIds.length === 0) return;

  const lines: string[] = [MSG.digestHeader, ''];

  const totalNew = scrapeResults.reduce((s, r) => s + r.transactionsNew, 0);
  const totalFound = scrapeResults.reduce((s, r) => s + r.transactionsFound, 0);
  const failures = scrapeResults.filter((r) => !r.success);

  if (totalNew > 0) {
    const today = todayInIsrael();
    const yesterday = yesterdayInIsrael();

    const recentTxns = db
      .select({
        chargedAmount: transactions.chargedAmount,
        description: transactions.description,
      })
      .from(transactions)
      .where(
        and(
          gte(transactions.date, yesterday),
          lte(transactions.date, today),
          eq(transactions.ignored, false),
        ),
      )
      .all();

    const totalSpent = recentTxns
      .filter((t) => t.chargedAmount < 0)
      .reduce((s, t) => s + Math.abs(t.chargedAmount), 0);
    const totalIncome = recentTxns
      .filter((t) => t.chargedAmount > 0)
      .reduce((s, t) => s + t.chargedAmount, 0);

    lines.push(`**${totalNew}** new transactions found (${totalFound} total scanned)`);
    if (totalSpent > 0) lines.push(`Spending: ₪${fmt(totalSpent)}`);
    if (totalIncome > 0) lines.push(`Income: ₪${fmt(totalIncome)}`);

    // Flag large charges
    const threshold = settings.dailyDigest.largeChargeThreshold;
    const largeCharges = recentTxns
      .filter((t) => Math.abs(t.chargedAmount) >= threshold)
      .sort((a, b) => Math.abs(b.chargedAmount) - Math.abs(a.chargedAmount));

    if (largeCharges.length > 0) {
      lines.push('');
      lines.push(MSG.largeChargesHeader(fmt(threshold)));
      for (const tx of largeCharges.slice(0, 5)) {
        const dir = tx.chargedAmount < 0 ? '−' : '+';
        lines.push(`• ${dir}₪${fmt(Math.abs(tx.chargedAmount))} — ${tx.description}`);
      }
    }
  } else {
    lines.push(MSG.noTransactions);
  }

  // Report failures — batch account name lookup
  if (settings.dailyDigest.reportErrors && failures.length > 0) {
    const failedIds = failures.map((f) => f.accountId);
    const acctRows =
      failedIds.length > 0
        ? db
            .select({ id: accounts.id, displayName: accounts.displayName })
            .from(accounts)
            .where(inArray(accounts.id, failedIds))
            .all()
        : [];
    const nameMap = new Map(acctRows.map((a) => [a.id, a.displayName]));

    lines.push('');
    lines.push(MSG.scrapeErrorsHeader(failures.length));
    for (const f of failures) {
      const name = nameMap.get(f.accountId) ?? `Account #${f.accountId}`;
      lines.push(`• ${name}: ${f.error ?? f.errorType ?? 'Unknown error'}`);
    }
  }

  await sendAlert(chatIds, lines.join('\n'));
}

// ── 2. Unusual Spending Alert ─────────────────────────────────────────────────

export async function checkUnusualSpending(): Promise<void> {
  const settings = loadAlertSettings() as any; // TODO: Task 4 will rewrite this function
  if (!settings.enabled || !settings.unusualSpending?.enabled) return;

  const chatIds = getChatIds();
  if (chatIds.length === 0) return;

  const threshold = settings.unusualSpending.percentThreshold;
  const today = todayInIsrael();
  const [year, month] = today.split('-').map(Number);
  const dayOfMonth = parseInt(today.split('-')[2]);

  const currentStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const prev = monthOffset(year, month, -1);
  const prevEnd = `${prev.year}-${String(prev.month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;

  const result = comparePeriods({
    period1Start: prev.start,
    period1End: prevEnd,
    period2Start: currentStart,
    period2End: today,
  });

  const spikes = result.comparison.filter((c) => {
    if (c.change_percent === null) return false;
    return c.period2_total < 0 && c.change_percent < -threshold;
  });

  if (spikes.length === 0) return;

  const labelMap = getCategoryLabelMap();
  const lines: string[] = [MSG.unusualSpendingHeader, ''];

  for (const spike of spikes.slice(0, 5)) {
    const label = labelMap.get(spike.category) ?? spike.category;
    const pct = Math.abs(spike.change_percent!);
    lines.push(
      `• **${label}**: ₪${fmt(Math.abs(spike.period2_total))} this month — ` +
        `**${Math.round(pct)}% higher** than the same point last month`,
    );
  }

  await sendAlert(chatIds, lines.join('\n'));
}

// ── 3. New Recurring Charge Detected ──────────────────────────────────────────

export async function checkNewRecurring(): Promise<void> {
  const settings = loadAlertSettings() as any; // TODO: Task 4 will rewrite this function
  if (!settings.enabled || !settings.newRecurring?.enabled) return;

  const chatIds = getChatIds();
  if (chatIds.length === 0) return;

  const { recurring } = detectRecurringTransactions({ monthsBack: 6, minOccurrences: 2 });
  const currentDescriptions = recurring.map((r) => r.description);
  const known = new Set(settings._knownRecurring ?? []);

  const newOnes = recurring.filter((r) => !known.has(r.description));

  if (newOnes.length > 0) {
    const lines: string[] = [MSG.newRecurringHeader, ''];
    for (const r of newOnes.slice(0, 5)) {
      const amt = r.avg_amount < 0 ? `₪${fmt(Math.abs(r.avg_amount))}` : `+₪${fmt(r.avg_amount)}`;
      lines.push(
        `• **${r.description}**: ${amt}/${r.frequency}` +
          ` (est. annual: ₪${fmt(Math.abs(r.estimated_annual_cost))})`,
      );
    }
    await sendAlert(chatIds, lines.join('\n'));
  }

  // Update known list
  settings._knownRecurring = currentDescriptions;
  saveAlertSettings(settings);
}

// ── 4. Low-Confidence Categorization Review ───────────────────────────────────

export async function checkReviewNeeded(): Promise<void> {
  const settings = loadAlertSettings() as any; // TODO: Task 4 will rewrite this function
  if (!settings.enabled || !settings.reviewReminder?.enabled) return;

  const chatIds = getChatIds();
  if (chatIds.length === 0) return;

  // Single query for both counts
  const counts = db
    .select({
      reviewCount: sql<number>`SUM(CASE WHEN ${transactions.needsReview} = 1 THEN 1 ELSE 0 END)`,
      uncatCount: sql<number>`SUM(CASE WHEN ${transactions.category} IS NULL THEN 1 ELSE 0 END)`,
    })
    .from(transactions)
    .get();

  const reviewCount = counts?.reviewCount ?? 0;
  const uncatCount = counts?.uncatCount ?? 0;
  if (reviewCount === 0 && uncatCount === 0) return;

  const lines: string[] = [MSG.reviewHeader, ''];
  if (reviewCount > 0) {
    lines.push(
      `**${reviewCount}** transaction(s) flagged for review (low confidence categorization)`,
    );
  }
  if (uncatCount > 0) {
    lines.push(`**${uncatCount}** transaction(s) still uncategorized`);
  }
  lines.push('');
  lines.push(MSG.reviewCta);

  await sendAlert(chatIds, lines.join('\n'));
}

// ── 5. Monthly Summary ────────────────────────────────────────────────────────

export async function sendMonthlySummary(): Promise<void> {
  const settings = loadAlertSettings();
  if (!settings.enabled || !settings.monthlySummary.enabled) return;

  const chatIds = getChatIds();
  if (chatIds.length === 0) return;

  const today = todayInIsrael();
  const [year, month] = today.split('-').map(Number);

  const prev = monthOffset(year, month, -1);
  const prev2 = monthOffset(year, month, -2);

  // Get cashflow for last month
  const cashflow = getSpendingSummary({ startDate: prev.start, endDate: prev.end }, 'cashflow');
  const cfRow = cashflow.summary[0] as { income?: number; expense?: number } | undefined;
  const income = cfRow?.income ?? 0;
  const expense = cfRow?.expense ?? 0;
  const savings = income - expense;
  const savingsRate = income > 0 ? (savings / income) * 100 : 0;

  // Top spending categories
  const catSummary = getSpendingSummary({ startDate: prev.start, endDate: prev.end }, 'category');
  const topCats = (catSummary.summary as Array<{ category?: string; totalAmount: number }>)
    .filter((s) => s.totalAmount < 0)
    .sort((a, b) => a.totalAmount - b.totalAmount)
    .slice(0, 3);

  const labelMap = getCategoryLabelMap();

  // Month-over-month comparison
  const comparison = comparePeriods({
    period1Start: prev2.start,
    period1End: prev2.end,
    period2Start: prev.start,
    period2End: prev.end,
  });

  const monthLabel = MONTH_NAMES[prev.month - 1];

  const lines: string[] = [
    MSG.monthlySummaryHeader(monthLabel, prev.year),
    '',
    `💰 Income: ₪${fmt(income)}`,
    `💸 Spending: ₪${fmt(expense)}`,
    `${savings >= 0 ? '✅' : '⚠️'} Net: ${savings >= 0 ? '+' : ''}₪${fmt(savings)} (${Math.round(savingsRate)}% savings rate)`,
  ];

  if (topCats.length > 0) {
    lines.push('');
    lines.push('**Top spending categories:**');
    for (const cat of topCats) {
      const label =
        labelMap.get(cat.category ?? 'uncategorized') ?? cat.category ?? 'uncategorized';
      lines.push(`• ${label}: ₪${fmt(Math.abs(cat.totalAmount))}`);
    }
  }

  if (comparison.summary.change_percent !== null) {
    const pct = comparison.summary.change_percent;
    const dir = pct < 0 ? 'less' : 'more';
    lines.push('');
    lines.push(
      `vs. ${MONTH_NAMES[prev2.month - 1]}: You spent **${Math.abs(Math.round(pct))}% ${dir}**`,
    );
  }

  await sendAlert(chatIds, lines.join('\n'));
}

// ── 6. Net Worth Milestone / Change ───────────────────────────────────────────

export async function checkNetWorthChanges(): Promise<void> {
  const settings = loadAlertSettings() as any; // TODO: Task 4 will rewrite this function
  if (!settings.enabled || !settings.netWorthChange?.enabled) return;

  const chatIds = getChatIds();
  if (chatIds.length === 0) return;

  try {
    const netWorth = await getNetWorth();
    const current = netWorth.total;
    const last = settings._lastNetWorthTotal;

    if (last === undefined) {
      settings._lastNetWorthTotal = current;
      saveAlertSettings(settings);
      return;
    }

    const change = current - last;
    const absChange = Math.abs(change);
    const lines: string[] = [];

    // Check milestone crossings
    const interval = settings.netWorthChange.milestoneInterval;
    if (interval > 0) {
      const prevMilestone = Math.floor(last / interval) * interval;
      const currMilestone = Math.floor(current / interval) * interval;
      if (currMilestone > prevMilestone) {
        lines.push(MSG.netWorthMilestone);
        lines.push('');
        lines.push(`Your net worth crossed **₪${fmt(currMilestone)}**!`);
        lines.push(`Current: ₪${fmt(current)}`);
      } else if (currMilestone < prevMilestone) {
        lines.push(MSG.netWorthDrop);
        lines.push('');
        lines.push(`Your net worth dropped below ₪${fmt(prevMilestone + interval)}`);
        lines.push(`Current: ₪${fmt(current)}`);
      }
    }

    // Check significant change
    if (lines.length === 0 && absChange >= settings.netWorthChange.changeThreshold) {
      const emoji = change > 0 ? '📈' : '📉';
      const dir = change > 0 ? 'increased' : 'decreased';
      lines.push(MSG.netWorthChange(emoji, dir, fmt(absChange)));
      lines.push('');
      lines.push(`Current: ₪${fmt(current)} (was ₪${fmt(last)})`);
    }

    if (lines.length > 0) {
      await sendAlert(chatIds, lines.join('\n'));
    }

    settings._lastNetWorthTotal = current;
    saveAlertSettings(settings);
  } catch (err) {
    console.error('[Alerts] Net worth check failed:', err instanceof Error ? err.message : err);
  }
}

// ── Orchestration ─────────────────────────────────────────────────────────────

/** Run a named alert function, logging errors without throwing. */
async function safeRun(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[Alerts] ${name} failed:`, err instanceof Error ? err.message : err);
  }
}

/** Run all post-scrape alerts. Called after a scrape session completes. */
export async function runPostScrapeAlerts(scrapeResults: ScrapeResult[]): Promise<void> {
  // Digest must run first (it's the primary notification)
  await safeRun('Daily digest', () => sendPostScrapeDigest(scrapeResults));

  // These are independent — run in parallel
  await Promise.allSettled([
    safeRun('Unusual spending', checkUnusualSpending),
    safeRun('Review check', checkReviewNeeded),
    safeRun('Net worth', checkNetWorthChanges),
  ]);

  // Recurring must run after the parallel batch (it writes to settings)
  await safeRun('Recurring check', checkNewRecurring);
}
