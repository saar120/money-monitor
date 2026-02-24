import { createScraper, CompanyTypes } from 'israeli-bank-scrapers';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts, transactions, scrapeLogs } from '../db/schema.js';
import { getCredentials } from './credential-store.js';
import { config } from '../config.js';
import type { Account, ScraperTransaction, NewTransaction } from '../shared/types.js';

function computeHash(accountId: number, txn: ScraperTransaction): string {
  const raw = `${accountId}:${txn.date}:${txn.chargedAmount}:${txn.description}`;
  return createHash('sha256').update(raw).digest('hex');
}

function mapTransaction(accountId: number, txn: ScraperTransaction): NewTransaction {
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
    const scraper = createScraper({
      companyId: CompanyTypes[account.companyId as keyof typeof CompanyTypes],
      startDate,
      combineInstallments: false,
      showBrowser: false,
    });

    // Cast to any since credential shape varies by company
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await scraper.scrape(credentials as any);

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

    for (const scraperAccount of result.accounts ?? []) {
      if (scraperAccount.accountNumber && !account.accountNumber) {
        db.update(accounts)
          .set({ accountNumber: scraperAccount.accountNumber })
          .where(eq(accounts.id, account.id))
          .run();
      }

      const txns = scraperAccount.txns ?? [];
      totalFound += txns.length;

      for (const txn of txns) {
        const mapped = mapTransaction(account.id, txn);
        try {
          const result = db.insert(transactions)
            .values(mapped)
            .onConflictDoNothing({ target: transactions.hash })
            .run();
          if (result.changes > 0) {
            totalNew++;
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
