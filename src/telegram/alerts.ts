import { and, eq, gte, lte, sql, isNull } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { transactions, scrapeLogs, accounts, categories } from '../db/schema.js';
import { loadAlertSettings, saveAlertSettings } from './alert-settings.js';
import {
  getSpendingTrends,
  detectRecurringTransactions,
  getSpendingSummary,
  comparePeriods,
} from '../services/summary.js';
import { getNetWorth } from '../services/net-worth.js';
import { todayInIsrael, monthsAgoStart } from '../shared/dates.js';
import { markdownToTelegramHtml } from './format.js';
import type { ScrapeResult } from '../scraper/scraper.service.js';

const MAX_MESSAGE_LENGTH = 4096;

// ── Telegram send helper ──────────────────────────────────────────────────────

/** Import bot dynamically to avoid circular deps */
let _sendMessage: ((chatId: number, html: string) => Promise<void>) | null = null;

export function registerSendMessage(fn: (chatId: number, html: string) => Promise<void>) {
  _sendMessage = fn;
}

function splitMessage(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf('\n', MAX_MESSAGE_LENGTH);
    if (splitAt <= 0) splitAt = MAX_MESSAGE_LENGTH;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, '');
  }
  return chunks;
}

async function sendAlert(chatIds: number[], markdown: string): Promise<void> {
  if (!_sendMessage || chatIds.length === 0) return;
  const html = markdownToTelegramHtml(markdown);
  for (const chatId of chatIds) {
    for (const chunk of splitMessage(html)) {
      try {
        await _sendMessage(chatId, chunk);
      } catch (err) {
        console.error(`[Alerts] Failed to send to chat ${chatId}:`, err instanceof Error ? err.message : err);
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

// ── Formatting helpers ────────────────────────────────────────────────────────

const fmt = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1000) {
    return n.toLocaleString('en-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  return n.toLocaleString('en-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtPercent = (n: number): string => `${n > 0 ? '+' : ''}${Math.round(n)}%`;

// ── 1. Post-Scrape Daily Digest ───────────────────────────────────────────────

export async function sendPostScrapeDigest(scrapeResults: ScrapeResult[]): Promise<void> {
  const settings = loadAlertSettings();
  if (!settings.enabled || !settings.dailyDigest.enabled) return;

  const chatIds = getChatIds();
  if (chatIds.length === 0) return;

  const lines: string[] = ['**📊 Scrape Complete**', ''];

  // Summarize results
  const totalNew = scrapeResults.reduce((s, r) => s + r.transactionsNew, 0);
  const totalFound = scrapeResults.reduce((s, r) => s + r.transactionsFound, 0);
  const successes = scrapeResults.filter(r => r.success);
  const failures = scrapeResults.filter(r => !r.success);

  if (totalNew > 0) {
    // Get the new transactions to sum amounts
    const today = todayInIsrael();
    const yesterday = new Date(new Date().setDate(new Date().getDate() - 1))
      .toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

    const recentTxns = db.select({
      chargedAmount: transactions.chargedAmount,
      description: transactions.description,
      category: transactions.category,
    }).from(transactions)
      .where(and(
        gte(transactions.date, yesterday),
        lte(transactions.date, today),
        eq(transactions.ignored, false),
      ))
      .all();

    const totalSpent = recentTxns
      .filter(t => t.chargedAmount < 0)
      .reduce((s, t) => s + Math.abs(t.chargedAmount), 0);
    const totalIncome = recentTxns
      .filter(t => t.chargedAmount > 0)
      .reduce((s, t) => s + t.chargedAmount, 0);

    lines.push(`**${totalNew}** new transactions found (${totalFound} total scanned)`);
    if (totalSpent > 0) lines.push(`Spending: ₪${fmt(totalSpent)}`);
    if (totalIncome > 0) lines.push(`Income: ₪${fmt(totalIncome)}`);

    // Flag large charges
    const threshold = settings.dailyDigest.largeChargeThreshold;
    const largeCharges = recentTxns
      .filter(t => Math.abs(t.chargedAmount) >= threshold)
      .sort((a, b) => Math.abs(b.chargedAmount) - Math.abs(a.chargedAmount));

    if (largeCharges.length > 0) {
      lines.push('');
      lines.push(`**⚠️ Large charges (≥₪${fmt(threshold)}):**`);
      for (const tx of largeCharges.slice(0, 5)) {
        const dir = tx.chargedAmount < 0 ? '−' : '+';
        lines.push(`• ${dir}₪${fmt(Math.abs(tx.chargedAmount))} — ${tx.description}`);
      }
    }
  } else {
    lines.push('No new transactions found.');
  }

  // Report failures
  if (settings.dailyDigest.reportErrors && failures.length > 0) {
    lines.push('');
    lines.push(`**❌ ${failures.length} scrape error(s):**`);
    for (const f of failures) {
      const acct = db.select({ displayName: accounts.displayName })
        .from(accounts).where(eq(accounts.id, f.accountId)).get();
      const name = acct?.displayName ?? `Account #${f.accountId}`;
      lines.push(`• ${name}: ${f.error ?? f.errorType ?? 'Unknown error'}`);
    }
  }

  await sendAlert(chatIds, lines.join('\n'));
}

// ── 2. Unusual Spending Alert ─────────────────────────────────────────────────

export async function checkUnusualSpending(): Promise<void> {
  const settings = loadAlertSettings();
  if (!settings.enabled || !settings.unusualSpending.enabled) return;

  const chatIds = getChatIds();
  if (chatIds.length === 0) return;

  const threshold = settings.unusualSpending.percentThreshold;
  const today = todayInIsrael();
  const [year, month] = today.split('-').map(Number);

  // Current month so far
  const currentStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const currentEnd = today;

  // Same period last month (day 1 to same day)
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const dayOfMonth = parseInt(today.split('-')[2]);
  const prevStart = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
  const prevEnd = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;

  // Compare by category
  const result = comparePeriods({
    period1Start: prevStart,
    period1End: prevEnd,
    period2Start: currentStart,
    period2End: currentEnd,
  });

  const spikes = result.comparison.filter(c => {
    if (c.change_percent === null) return false;
    // Only flag spending increases (negative amounts = spending)
    return c.period2_total < 0 && c.change_percent < -threshold;
  });

  if (spikes.length === 0) return;

  // Get category labels
  const catRows = db.select({ name: categories.name, label: categories.label })
    .from(categories).all();
  const labelMap = new Map(catRows.map(c => [c.name, c.label]));

  const lines: string[] = ['**📈 Unusual Spending Alert**', ''];

  for (const spike of spikes.slice(0, 5)) {
    const label = labelMap.get(spike.category) ?? spike.category;
    const pct = Math.abs(spike.change_percent!);
    lines.push(
      `• **${label}**: ₪${fmt(Math.abs(spike.period2_total))} this month — ` +
      `**${Math.round(pct)}% higher** than the same point last month`
    );
  }

  await sendAlert(chatIds, lines.join('\n'));
}

// ── 3. New Recurring Charge Detected ──────────────────────────────────────────

export async function checkNewRecurring(): Promise<void> {
  const settings = loadAlertSettings();
  if (!settings.enabled || !settings.newRecurring.enabled) return;

  const chatIds = getChatIds();
  if (chatIds.length === 0) return;

  const { recurring } = detectRecurringTransactions({ monthsBack: 6, minOccurrences: 2 });
  const currentDescriptions = recurring.map(r => r.description);
  const known = new Set(settings._knownRecurring ?? []);

  const newOnes = recurring.filter(r => !known.has(r.description));

  if (newOnes.length > 0) {
    const lines: string[] = ['**🔄 New Recurring Charges Detected**', ''];
    for (const r of newOnes.slice(0, 5)) {
      const amt = r.avg_amount < 0 ? `₪${fmt(Math.abs(r.avg_amount))}` : `+₪${fmt(r.avg_amount)}`;
      lines.push(
        `• **${r.description}**: ${amt}/${r.frequency}` +
        ` (est. annual: ₪${fmt(Math.abs(r.estimated_annual_cost))})`
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
  const settings = loadAlertSettings();
  if (!settings.enabled || !settings.reviewReminder.enabled) return;

  const chatIds = getChatIds();
  if (chatIds.length === 0) return;

  const count = db.select({ count: sql<number>`COUNT(*)` })
    .from(transactions)
    .where(eq(transactions.needsReview, true))
    .get();

  const reviewCount = count?.count ?? 0;
  if (reviewCount === 0) return;

  const uncategorized = db.select({ count: sql<number>`COUNT(*)` })
    .from(transactions)
    .where(isNull(transactions.category))
    .get();
  const uncatCount = uncategorized?.count ?? 0;

  const lines: string[] = ['**🔍 Transactions Need Review**', ''];
  if (reviewCount > 0) {
    lines.push(`**${reviewCount}** transaction(s) flagged for review (low confidence categorization)`);
  }
  if (uncatCount > 0) {
    lines.push(`**${uncatCount}** transaction(s) still uncategorized`);
  }
  lines.push('');
  lines.push('Open the Insights page to review them.');

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

  // Last month
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevStart = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month - 1, 0).getDate(); // last day of prev month
  const prevEnd = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  // Two months ago for comparison
  const prev2Month = prevMonth === 1 ? 12 : prevMonth - 1;
  const prev2Year = prevMonth === 1 ? prevYear - 1 : prevYear;
  const prev2Start = `${prev2Year}-${String(prev2Month).padStart(2, '0')}-01`;
  const lastDay2 = new Date(prevYear, prevMonth - 1, 0).getDate();
  const prev2End = `${prev2Year}-${String(prev2Month).padStart(2, '0')}-${String(lastDay2).padStart(2, '0')}`;

  // Get cashflow for last month
  const cashflow = getSpendingSummary(
    { startDate: prevStart, endDate: prevEnd },
    'cashflow',
  );
  const cf = (cashflow as any).summary?.[0] ?? { income: 0, expense: 0 };
  const income = cf.income ?? 0;
  const expense = cf.expense ?? 0;
  const savings = income - expense;
  const savingsRate = income > 0 ? (savings / income) * 100 : 0;

  // Top spending categories
  const catSummary = getSpendingSummary(
    { startDate: prevStart, endDate: prevEnd },
    'category',
  );
  const topCats = (catSummary as any).summary
    ?.filter((s: any) => s.totalAmount < 0)
    .sort((a: any, b: any) => a.totalAmount - b.totalAmount)
    .slice(0, 3) ?? [];

  // Get category labels
  const catRows = db.select({ name: categories.name, label: categories.label })
    .from(categories).all();
  const labelMap = new Map(catRows.map(c => [c.name, c.label]));

  // Month-over-month comparison
  const comparison = comparePeriods({
    period1Start: prev2Start,
    period1End: prev2End,
    period2Start: prevStart,
    period2End: prevEnd,
  });

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabel = monthNames[prevMonth - 1];

  const lines: string[] = [
    `**📅 Monthly Summary — ${monthLabel} ${prevYear}**`,
    '',
    `💰 Income: ₪${fmt(income)}`,
    `💸 Spending: ₪${fmt(expense)}`,
    `${savings >= 0 ? '✅' : '⚠️'} Net: ${savings >= 0 ? '+' : ''}₪${fmt(savings)} (${Math.round(savingsRate)}% savings rate)`,
  ];

  if (topCats.length > 0) {
    lines.push('');
    lines.push('**Top spending categories:**');
    for (const cat of topCats) {
      const label = labelMap.get(cat.category) ?? cat.category;
      lines.push(`• ${label}: ₪${fmt(Math.abs(cat.totalAmount))}`);
    }
  }

  if (comparison.summary.change_percent !== null) {
    const pct = comparison.summary.change_percent;
    const dir = pct < 0 ? 'less' : 'more';
    lines.push('');
    lines.push(`vs. ${monthNames[prev2Month - 1]}: You spent **${Math.abs(Math.round(pct))}% ${dir}**`);
  }

  await sendAlert(chatIds, lines.join('\n'));
}

// ── 6. Net Worth Milestone / Change ───────────────────────────────────────────

export async function checkNetWorthChanges(): Promise<void> {
  const settings = loadAlertSettings();
  if (!settings.enabled || !settings.netWorthChange.enabled) return;

  const chatIds = getChatIds();
  if (chatIds.length === 0) return;

  try {
    const netWorth = await getNetWorth();
    const current = netWorth.total;
    const last = settings._lastNetWorthTotal;

    if (last === undefined) {
      // First run — just record current
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
        lines.push(`**🎉 Net Worth Milestone!**`);
        lines.push('');
        lines.push(`Your net worth crossed **₪${fmt(currMilestone)}**!`);
        lines.push(`Current: ₪${fmt(current)}`);
      } else if (currMilestone < prevMilestone) {
        lines.push(`**📉 Net Worth Alert**`);
        lines.push('');
        lines.push(`Your net worth dropped below ₪${fmt(prevMilestone + interval)}`);
        lines.push(`Current: ₪${fmt(current)}`);
      }
    }

    // Check significant change
    if (lines.length === 0 && absChange >= settings.netWorthChange.changeThreshold) {
      const emoji = change > 0 ? '📈' : '📉';
      const dir = change > 0 ? 'increased' : 'decreased';
      lines.push(`**${emoji} Net Worth ${dir} by ₪${fmt(absChange)}**`);
      lines.push('');
      lines.push(`Current: ₪${fmt(current)} (was ₪${fmt(last)})`);
    }

    if (lines.length > 0) {
      await sendAlert(chatIds, lines.join('\n'));
    }

    // Always update last known value
    settings._lastNetWorthTotal = current;
    saveAlertSettings(settings);
  } catch (err) {
    console.error('[Alerts] Net worth check failed:', err instanceof Error ? err.message : err);
  }
}

// ── Orchestration ─────────────────────────────────────────────────────────────

/** Run all post-scrape alerts. Called after a scrape session completes. */
export async function runPostScrapeAlerts(scrapeResults: ScrapeResult[]): Promise<void> {
  try {
    await sendPostScrapeDigest(scrapeResults);
  } catch (err) {
    console.error('[Alerts] Daily digest failed:', err instanceof Error ? err.message : err);
  }

  try {
    await checkUnusualSpending();
  } catch (err) {
    console.error('[Alerts] Unusual spending check failed:', err instanceof Error ? err.message : err);
  }

  try {
    await checkNewRecurring();
  } catch (err) {
    console.error('[Alerts] Recurring check failed:', err instanceof Error ? err.message : err);
  }

  try {
    await checkReviewNeeded();
  } catch (err) {
    console.error('[Alerts] Review check failed:', err instanceof Error ? err.message : err);
  }

  try {
    await checkNetWorthChanges();
  } catch (err) {
    console.error('[Alerts] Net worth check failed:', err instanceof Error ? err.message : err);
  }
}
