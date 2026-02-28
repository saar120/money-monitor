import { createScraper, CompanyTypes } from 'israeli-bank-scrapers';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts, transactions, scrapeLogs } from '../db/schema.js';
import { getCredentials } from './credential-store.js';
import { config } from '../config.js';
import type { Account, ScraperTransaction, NewTransaction, CompanyId } from '../shared/types.js';
import { getAccountType } from '../shared/types.js';
import { waitForOtp } from './otp-bridge.js';
import { waitForManualAction } from './manual-action-bridge.js';
import { broadcastSseEvent } from '../api/sse.js';
import { batchCategorize } from '../ai/agent.js';

const MANUAL_LOGIN_COMPANIES = new Set(['isracard', 'amex']);

function computeHash(accountId: number, txn: ScraperTransaction): string {
  const raw = `${accountId}:${txn.date}:${txn.chargedAmount}:${txn.description}`;
  return createHash('sha256').update(raw).digest('hex');
}

function mapTransaction(accountId: number, txn: ScraperTransaction): NewTransaction {
  const meta: Record<string, string> = {};
  if (txn.category) meta.bankCategory = txn.category;

  return {
    accountId,
    identifier: txn.identifier != null ? Number(txn.identifier) : null,
    date: txn.date,
    processedDate: txn.processedDate,
    originalAmount: txn.originalAmount,
    originalCurrency: txn.originalCurrency,
    chargedAmount: txn.chargedAmount,
    description: txn.description,
    memo: txn.memo ?? null,
    type: txn.type,
    status: txn.status,
    installmentNumber: txn.installments?.number ?? null,
    installmentTotal: txn.installments?.total ?? null,
    meta: Object.keys(meta).length > 0 ? JSON.stringify(meta) : null,
    hash: computeHash(accountId, txn),
  };
}

export interface ScrapeResult {
  success: boolean;
  accountId: number;
  transactionsFound: number;
  transactionsNew: number;
  error?: string;
  errorType?: string;
}

export async function scrapeAccount(account: Account): Promise<ScrapeResult> {
  const startedAt = new Date().toISOString();

  const credentials = getCredentials(account.credentialsRef);
  if (!credentials) {
    const errorResult = {
      success: false,
      accountId: account.id,
      transactionsFound: 0,
      transactionsNew: 0,
      error: 'No credentials found for this account',
      errorType: 'MISSING_CREDENTIALS',
    };
    db.insert(scrapeLogs).values({
      accountId: account.id,
      status: 'error',
      errorType: 'MISSING_CREDENTIALS',
      errorMessage: errorResult.error,
      transactionsFound: 0,
      startedAt,
      completedAt: new Date().toISOString(),
    }).run();
    return errorResult;
  }

  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - config.SCRAPE_START_DATE_MONTHS_BACK);

  try {
    const accountType = getAccountType(account.companyId as CompanyId);

    const needsManualLogin = MANUAL_LOGIN_COMPANIES.has(account.companyId);

    const scraper = createScraper({
      companyId: CompanyTypes[account.companyId as keyof typeof CompanyTypes],
      startDate,
      combineInstallments: false,
      showBrowser: needsManualLogin ? true : config.SCRAPE_SHOW_BROWSER,
      timeout: config.SCRAPE_TIMEOUT,
      defaultTimeout: config.SCRAPE_TIMEOUT,
      args: ['--no-sandbox', '--disable-gpu', '--disable-blink-features=AutomationControlled'],
      ...(accountType === 'credit_card' ? { futureMonthsToScrape: 1 } : {}),
    });

    // For manual login companies: override login() to open the page and wait for user
    if (needsManualLogin) {
      const originalLogin = (scraper as any).login.bind(scraper);
      (scraper as any).login = async () => {
        // Navigate to the login page
        await (scraper as any).navigateTo(`https://digital.isracard.co.il/personalarea/Login`);

        // Ask the user to log in manually via the dashboard
        await waitForManualAction(account.id, () => {
          broadcastSseEvent({
            type: 'manual-action-required',
            accountId: account.id,
            message: `Please log in manually for ${account.displayName}. A browser window is open — complete the login there, then click "Done" here.`,
          });
        });

        return { success: true };
      };
    }

    const otpCodeRetriever = async () => {
      return waitForOtp(account.id, () => {
        broadcastSseEvent({
          type: 'otp-required',
          accountId: account.id,
          message: `OTP required for ${account.displayName}`,
        });
      });
    };

    // Cast to any since credential shape varies by company
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await scraper.scrape({ ...credentials as any, otpCodeRetriever });

    if (!result.success) {
      db.insert(scrapeLogs).values({
        accountId: account.id,
        status: 'error',
        errorType: result.errorType ?? 'UNKNOWN_ERROR',
        errorMessage: result.errorMessage ?? 'Scrape failed',
        transactionsFound: 0,
        startedAt,
        completedAt: new Date().toISOString(),
      }).run();

      return {
        success: false,
        accountId: account.id,
        transactionsFound: 0,
        transactionsNew: 0,
        error: result.errorMessage,
        errorType: result.errorType,
      };
    }

    let totalFound = 0;
    let totalNew = 0;
    const newIds: number[] = [];

    for (const scraperAccount of result.accounts ?? []) {
      if (scraperAccount.accountNumber && !account.accountNumber) {
        db.update(accounts)
          .set({ accountNumber: scraperAccount.accountNumber })
          .where(eq(accounts.id, account.id))
          .run();
      }

      if (scraperAccount.balance != null) {
        db.update(accounts)
          .set({ balance: scraperAccount.balance })
          .where(eq(accounts.id, account.id))
          .run();
      }

      const txns = scraperAccount.txns ?? [];
      totalFound += txns.length;

      for (const txn of txns) {
        if (txn.status === 'pending') continue;

        const mapped = mapTransaction(account.id, txn);
        try {
          const result = db.insert(transactions)
            .values(mapped)
            .onConflictDoNothing({ target: transactions.hash })
            .run();
          if (result.changes > 0) {
            totalNew++;
            newIds.push(Number(result.lastInsertRowid));
          }
        } catch {
          // Unexpected DB error, skip this transaction
        }
      }
    }

    db.update(accounts)
      .set({ lastScrapedAt: new Date().toISOString() })
      .where(eq(accounts.id, account.id))
      .run();

    db.insert(scrapeLogs).values({
      accountId: account.id,
      status: 'success',
      transactionsFound: totalFound,
      startedAt,
      completedAt: new Date().toISOString(),
    }).run();

    // Best-effort: categorize newly imported transactions in background
    if (newIds.length > 0) {
      batchCategorize(newIds.length, newIds).catch(() => {
        // Categorization failure must not break the scrape response
      });
    }

    return {
      success: true,
      accountId: account.id,
      transactionsFound: totalFound,
      transactionsNew: totalNew,
    };

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    db.insert(scrapeLogs).values({
      accountId: account.id,
      status: 'error',
      errorType: 'EXCEPTION',
      errorMessage,
      transactionsFound: 0,
      startedAt,
      completedAt: new Date().toISOString(),
    }).run();

    return {
      success: false,
      accountId: account.id,
      transactionsFound: 0,
      transactionsNew: 0,
      error: errorMessage,
      errorType: 'EXCEPTION',
    };
  }
}

export async function scrapeAllAccounts(): Promise<ScrapeResult[]> {
  const activeAccounts = db
    .select()
    .from(accounts)
    .where(eq(accounts.isActive, true))
    .all();

  const results: ScrapeResult[] = [];
  for (const account of activeAccounts) {
    const result = await scrapeAccount(account);
    results.push(result);
  }
  return results;
}
