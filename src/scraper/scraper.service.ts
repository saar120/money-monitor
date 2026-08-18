import { createScraper, CompanyTypes } from 'israeli-bank-scrapers-core';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/connection.js';
import {
  accounts,
  transactions,
  transactionSources,
  scrapeLogs,
  accountBalanceHistory,
} from '../db/schema.js';
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
import { applyOwnership } from '../services/ownership.js';
import { ensureChromium } from './chromium.js';
import { ensureOneZeroFetchPatch } from './one-zero-fetch-patch.js';
import {
  computeLegacyTransactionHash,
  ONE_ZERO_SCRAPER_SOURCE,
  ONE_ZERO_XLS_SOURCE,
  sanitizeOneZeroDescription,
  toExternalId,
} from '../services/transaction-identity.js';

export const MANUAL_LOGIN_COMPANIES = new Set(['isracard', 'amex']);

function mapTransaction(
  accountId: number,
  txn: ScraperTransaction,
  isOneZero = false,
): NewTransaction {
  const meta: Record<string, string> = {};
  if (txn.category) meta.bankCategory = txn.category;
  const description = isOneZero ? sanitizeOneZeroDescription(txn.description) : txn.description;

  return {
    accountId,
    identifier:
      txn.identifier != null && Number.isSafeInteger(Number(txn.identifier))
        ? Number(txn.identifier)
        : null,
    date: toIsraelDateStr(txn.date),
    processedDate: toIsraelDateStr(txn.processedDate),
    originalAmount: txn.originalAmount,
    originalCurrency: txn.originalCurrency,
    chargedAmount: txn.chargedAmount,
    description,
    memo: txn.memo ?? null,
    type: txn.type,
    status: txn.status,
    installmentNumber: txn.installments?.number ?? null,
    installmentTotal: txn.installments?.total ?? null,
    meta: Object.keys(meta).length > 0 ? JSON.stringify(meta) : null,
    hash: computeLegacyTransactionHash(accountId, txn.date, txn.chargedAmount, description),
  };
}

/**
 * Imported rows that collided with another legitimate transaction receive a
 * deterministic collision hash, so the legacy scraper hash cannot find them.
 * Only use this conservative fallback for rows explicitly marked as an XLS
 * One Zero source, and only when exactly one amount/date-pair candidate
 * exists. This prevents a later scrape from re-adding those rows without
 * weakening ordinary scraper deduplication.
 */
function findImportedOneZeroTransaction(accountId: number, txn: ScraperTransaction): number | null {
  const importedIds = db
    .select({ transactionId: transactionSources.transactionId })
    .from(transactionSources)
    .where(
      and(
        eq(transactionSources.accountId, accountId),
        eq(transactionSources.source, ONE_ZERO_XLS_SOURCE),
      ),
    )
    .all()
    .map((row) => row.transactionId);
  if (importedIds.length === 0) return null;

  const movementDate = toIsraelDateStr(txn.date);
  const processedDate = toIsraelDateStr(txn.processedDate);
  const candidates = db
    .select({
      id: transactions.id,
      date: transactions.date,
      processedDate: transactions.processedDate,
      chargedAmount: transactions.chargedAmount,
      description: transactions.description,
    })
    .from(transactions)
    .where(eq(transactions.accountId, accountId))
    .all()
    .filter(
      (candidate) =>
        importedIds.includes(candidate.id) &&
        Math.round(candidate.chargedAmount * 100) === Math.round(txn.chargedAmount * 100) &&
        ((candidate.date === movementDate && candidate.processedDate === processedDate) ||
          (candidate.date === processedDate && candidate.processedDate === movementDate)),
    );
  return candidates.length === 1 ? candidates[0].id : null;
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

    if (account.companyId === 'oneZero') {
      ensureOneZeroFetchPatch();
    }

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await scraper.scrape({ ...(credentials as any), otpCodeRetriever });

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

        const mapped = mapTransaction(targetAccount.id, txn, targetAccount.companyId === 'oneZero');
        const scraperExternalId =
          targetAccount.companyId === 'oneZero' ? toExternalId(txn.identifier) : null;
        try {
          // Provider identity is the strongest deduplication key. Check it
          // before the legacy hash so a movement whose description/date changed
          // between scraper runs cannot create a second transaction.
          const exactScraperSourceId = scraperExternalId
            ? db
                .select({ transactionId: transactionSources.transactionId })
                .from(transactionSources)
                .where(
                  and(
                    eq(transactionSources.accountId, targetAccount.id),
                    eq(transactionSources.source, ONE_ZERO_SCRAPER_SOURCE),
                    eq(transactionSources.externalId, scraperExternalId),
                  ),
                )
                .get()?.transactionId
            : undefined;
          const importedMatch =
            exactScraperSourceId == null && targetAccount.companyId === 'oneZero'
              ? findImportedOneZeroTransaction(targetAccount.id, txn)
              : null;
          let transactionId = exactScraperSourceId ?? importedMatch ?? undefined;
          let inserted = false;
          if (transactionId == null) {
            const insertResult = db
              .insert(transactions)
              .values({
                ...mapped,
                expenseOwnerType: targetAccount.memberId != null ? 'member' : 'unassigned',
                expenseOwnerMemberId: targetAccount.memberId ?? null,
                ownerSource: targetAccount.memberId != null ? 'account' : 'unassigned',
                ownerConfidence: targetAccount.memberId != null ? 1 : null,
                scrapeSessionId: sessionId ?? null,
              })
              .onConflictDoNothing({ target: transactions.hash })
              .run();
            if (insertResult.changes > 0) {
              transactionId = Number(insertResult.lastInsertRowid);
              inserted = true;
              accountNew++;
              newIds.push(transactionId);
            } else {
              transactionId = db
                .select({ id: transactions.id })
                .from(transactions)
                .where(eq(transactions.hash, mapped.hash))
                .get()?.id;
            }
          }

          // Keep provider movement IDs as text, even though the legacy
          // transactions.identifier column is integer for backwards compatibility.
          // When a later scrape sees a transaction imported from XLS and the
          // canonical legacy hash matches, attach its scraper identity instead of
          // creating another row.
          if (scraperExternalId && transactionId != null) {
            if (inserted || exactScraperSourceId == null) {
              db.insert(transactionSources)
                .values({
                  transactionId,
                  accountId: targetAccount.id,
                  source: ONE_ZERO_SCRAPER_SOURCE,
                  externalId: scraperExternalId,
                })
                .onConflictDoNothing({
                  target: [
                    transactionSources.accountId,
                    transactionSources.source,
                    transactionSources.externalId,
                  ],
                })
                .run();
            }
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
            .then(() => {
              applyOwnership({ ids: newIds });
            })
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
