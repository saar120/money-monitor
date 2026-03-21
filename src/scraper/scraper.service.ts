import { createScraper, CompanyTypes } from 'israeli-bank-scrapers-core';
import { createHash } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts, transactions, scrapeLogs, accountBalanceHistory } from '../db/schema.js';
import { getCredentials } from './credential-store.js';
import { config } from '../config.js';
import type {
  Account,
  ScraperTransaction,
  ScraperAccountResult,
  NewTransaction,
  CompanyId,
} from '../shared/types.js';
import { toIsraelDateStr, todayInIsrael } from '../shared/dates.js';
import { getAccountType } from '../shared/types.js';
import { waitForOtp } from './otp-bridge.js';
import { waitForManualAction } from './manual-action-bridge.js';
import { broadcastSseEvent } from '../api/sse.js';
import { batchCategorize } from '../ai/agent.js';
import { ensureChromium } from './chromium.js';

export const MANUAL_LOGIN_COMPANIES = new Set(['isracard', 'amex']);

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
    date: toIsraelDateStr(txn.date),
    processedDate: toIsraelDateStr(txn.processedDate),
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

/** Find or create a DB account row for a specific card returned by the scraper. */
function resolveAccountForCard(
  parentAccount: Account,
  scraperAccount: ScraperAccountResult,
): Account {
  const cardNumber = scraperAccount.accountNumber;

  // 1. If the parent account has no accountNumber yet, claim it for this card
  if (!parentAccount.accountNumber) {
    db.update(accounts)
      .set({ accountNumber: cardNumber })
      .where(eq(accounts.id, parentAccount.id))
      .run();
    return { ...parentAccount, accountNumber: cardNumber };
  }

  // 2. If this card matches the parent, return it
  if (parentAccount.accountNumber === cardNumber) {
    return parentAccount;
  }

  // 3. Look for an existing sibling account with same credentialsRef + accountNumber
  const existing = db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.credentialsRef, parentAccount.credentialsRef),
        eq(accounts.accountNumber, cardNumber),
      ),
    )
    .get();

  if (existing) return existing;

  // 4. Auto-create a new account for this card
  const suffix = cardNumber.slice(-4);
  const newAccount = db
    .insert(accounts)
    .values({
      companyId: parentAccount.companyId,
      displayName: `${parentAccount.displayName} (${suffix})`,
      accountNumber: cardNumber,
      accountType: getAccountType(parentAccount.companyId as CompanyId),
      credentialsRef: parentAccount.credentialsRef,
    })
    .returning()
    .get();

  return newAccount;
}

export interface ScrapeResult {
  success: boolean;
  accountId: number;
  transactionsFound: number;
  transactionsNew: number;
  durationMs: number;
  error?: string;
  errorType?: string;
}

export interface ScrapeAccountResult {
  results: ScrapeResult[];
  /** Background categorization promise — await before reading categories. */
  categorizePending: Promise<void> | null;
}

export async function scrapeAccount(
  account: Account,
  sessionId?: number,
  signal?: AbortSignal,
): Promise<ScrapeAccountResult> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  if (signal?.aborted) {
    return {
      results: [
        {
          success: false,
          accountId: account.id,
          transactionsFound: 0,
          transactionsNew: 0,
          durationMs: 0,
          error: 'Cancelled',
          errorType: 'CANCELLED',
        },
      ],
      categorizePending: null,
    };
  }

  const credentials = getCredentials(account.credentialsRef);
  if (!credentials) {
    const durationMs = Date.now() - startMs;
    console.error(
      `[Scrape] ${account.displayName}: No credentials found (ref: ${account.credentialsRef})`,
    );
    const errorResult = {
      success: false,
      accountId: account.id,
      transactionsFound: 0,
      transactionsNew: 0,
      durationMs,
      error: 'No credentials found for this account',
      errorType: 'MISSING_CREDENTIALS',
    };
    db.insert(scrapeLogs)
      .values({
        accountId: account.id,
        sessionId: sessionId ?? null,
        status: 'error',
        errorType: 'MISSING_CREDENTIALS',
        errorMessage: errorResult.error,
        transactionsFound: 0,
        transactionsNew: 0,
        durationMs,
        startedAt,
        completedAt: new Date().toISOString(),
      })
      .run();
    return { results: [errorResult], categorizePending: null };
  }

  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - config.SCRAPE_START_DATE_MONTHS_BACK);

  try {
    const accountType = getAccountType(account.companyId as CompanyId);
    const executablePath = await ensureChromium();

    const scraper = createScraper({
      companyId: CompanyTypes[account.companyId as keyof typeof CompanyTypes],
      startDate,
      combineInstallments: false,
      showBrowser: account.manualLogin || account.showBrowser,
      timeout: config.SCRAPE_TIMEOUT,
      defaultTimeout: config.SCRAPE_TIMEOUT,
      executablePath,
      args: ['--no-sandbox', '--disable-gpu', '--disable-blink-features=AutomationControlled'],
      ...(accountType === 'credit_card' ? { futureMonthsToScrape: 1 } : {}),
    });

    // For manual login: override login() to open the page and wait for user
    if (account.manualLogin) {
      (scraper as any).login = async () => {
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
    let result: Awaited<ReturnType<typeof scraper.scrape>>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result = await scraper.scrape({ ...(credentials as any), otpCodeRetriever });
    } catch (scrapeErr) {
      // The upstream OneZero scraper destructures API responses without checking for errors,
      // e.g. `const { resultData: { idToken } } = response` crashes when resultData is undefined.
      // Re-throw with a clearer message so the outer catch produces a useful log/error.
      const msg = scrapeErr instanceof Error ? scrapeErr.message : String(scrapeErr);
      if (msg.includes("reading 'idToken'") || msg.includes("reading 'otpToken'")) {
        throw new Error(
          'One Zero login failed after OTP verification — please verify your email and password are correct',
          { cause: scrapeErr },
        );
      }
      throw scrapeErr;
    }

    if (!result.success) {
      console.error(
        `[Scrape] ${account.displayName} (${account.companyId}) failed: ${result.errorType} — ${result.errorMessage}`,
      );
      const durationMs = Date.now() - startMs;
      db.insert(scrapeLogs)
        .values({
          accountId: account.id,
          sessionId: sessionId ?? null,
          status: 'error',
          errorType: result.errorType ?? 'UNKNOWN_ERROR',
          errorMessage: result.errorMessage ?? 'Scrape failed',
          transactionsFound: 0,
          transactionsNew: 0,
          durationMs,
          startedAt,
          completedAt: new Date().toISOString(),
        })
        .run();

      return {
        results: [
          {
            success: false,
            accountId: account.id,
            transactionsFound: 0,
            transactionsNew: 0,
            durationMs,
            error: result.errorMessage,
            errorType: result.errorType,
          },
        ],
        categorizePending: null,
      };
    }

    const allResults: ScrapeResult[] = [];
    const newIds: number[] = [];
    let parentRef = account;

    for (const scraperAccount of result.accounts ?? []) {
      const targetAccount = resolveAccountForCard(parentRef, scraperAccount);

      // Keep parent reference up to date so the next card sees the correct accountNumber
      if (targetAccount.id === parentRef.id) {
        parentRef = targetAccount;
      }

      if (scraperAccount.balance != null) {
        db.update(accounts)
          .set({ balance: scraperAccount.balance })
          .where(eq(accounts.id, targetAccount.id))
          .run();

        db.insert(accountBalanceHistory)
          .values({
            accountId: targetAccount.id,
            date: todayInIsrael(),
            balance: scraperAccount.balance,
          })
          .onConflictDoUpdate({
            target: [accountBalanceHistory.accountId, accountBalanceHistory.date],
            set: { balance: scraperAccount.balance },
          })
          .run();
      }

      const txns = scraperAccount.txns ?? [];
      let accountFound = 0;
      let accountNew = 0;

      for (const txn of txns) {
        if (txn.status === 'pending') continue;
        accountFound++;

        const mapped = mapTransaction(targetAccount.id, txn);
        try {
          const insertResult = db
            .insert(transactions)
            .values({ ...mapped, scrapeSessionId: sessionId ?? null })
            .onConflictDoNothing({ target: transactions.hash })
            .run();
          if (insertResult.changes > 0) {
            accountNew++;
            newIds.push(Number(insertResult.lastInsertRowid));
          }
        } catch (dbErr) {
          console.error(
            `[Scrape] DB insert failed for txn "${txn.description}":`,
            dbErr instanceof Error ? dbErr.message : dbErr,
          );
        }
      }

      const durationMs = Date.now() - startMs;
      db.insert(scrapeLogs)
        .values({
          accountId: targetAccount.id,
          sessionId: sessionId ?? null,
          status: 'success',
          transactionsFound: accountFound,
          transactionsNew: accountNew,
          durationMs,
          startedAt,
          completedAt: new Date().toISOString(),
        })
        .run();

      allResults.push({
        success: true,
        accountId: targetAccount.id,
        transactionsFound: accountFound,
        transactionsNew: accountNew,
        durationMs,
      });
    }

    // Update lastScrapedAt for all accounts sharing this credential
    db.update(accounts)
      .set({ lastScrapedAt: new Date().toISOString() })
      .where(eq(accounts.credentialsRef, account.credentialsRef))
      .run();

    // Fire categorization in background — caller can await if needed
    const categorizePending: Promise<void> | null =
      newIds.length > 0
        ? batchCategorize(newIds.length, newIds)
            .then(() => {})
            .catch((err) => {
              console.error(
                '[Scrape] Background categorization failed:',
                err instanceof Error ? err.message : err,
              );
            })
        : null;

    return { results: allResults, categorizePending };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(
      `[Scrape] ${account.displayName} (${account.companyId}) exception:`,
      errorMessage,
    );
    db.insert(scrapeLogs)
      .values({
        accountId: account.id,
        sessionId: sessionId ?? null,
        status: 'error',
        errorType: 'EXCEPTION',
        errorMessage,
        transactionsFound: 0,
        transactionsNew: 0,
        durationMs,
        startedAt,
        completedAt: new Date().toISOString(),
      })
      .run();

    return {
      results: [
        {
          success: false,
          accountId: account.id,
          transactionsFound: 0,
          transactionsNew: 0,
          durationMs,
          error: errorMessage,
          errorType: 'EXCEPTION',
        },
      ],
      categorizePending: null,
    };
  }
}
