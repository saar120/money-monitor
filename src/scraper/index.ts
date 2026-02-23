import { createScraper, CompanyTypes } from 'israeli-bank-scrapers';
import type { ProviderType, ScrapeResult } from '../types/index.js';
import type { AccountRepository } from '../storage/repositories/accounts.js';
import type { TransactionRepository } from '../storage/repositories/transactions.js';

/** Map our provider string to the scraper library's CompanyTypes enum */
const PROVIDER_MAP: Record<ProviderType, CompanyTypes> = {
  hapoalim: CompanyTypes.hapoalim,
  beinleumi: CompanyTypes.beinleumi,
  union: CompanyTypes.union,
  amex: CompanyTypes.amex,
  isracard: CompanyTypes.isracard,
  visaCal: CompanyTypes.visaCal,
  max: CompanyTypes.max,
  otsarHahayal: CompanyTypes.otsarHahayal,
  discount: CompanyTypes.discount,
  mercantile: CompanyTypes.mercantile,
  mizrahi: CompanyTypes.mizrahi,
  leumi: CompanyTypes.leumi,
  massad: CompanyTypes.massad,
  yahav: CompanyTypes.yahav,
  behatsdaa: CompanyTypes.behatsdaa,
  beyahadBishvilha: CompanyTypes.beyahadBishvilha,
  oneZero: CompanyTypes.oneZero,
  pagi: CompanyTypes.pagi,
};

export interface ScraperServiceOptions {
  /** How many days back to scrape (default: 60) */
  scrapeFromDaysBack?: number;
  /** Show a browser window during scraping (default: false, headless) */
  showBrowser?: boolean;
}

export class ScraperService {
  constructor(
    private accountRepo: AccountRepository,
    private transactionRepo: TransactionRepository,
    private options: ScraperServiceOptions = {},
  ) {}

  /** Scrape a single account by ID and store the results */
  async scrapeAccount(accountId: string): Promise<ScrapeResult> {
    const account = this.accountRepo.findById(accountId);
    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    const credentials = this.accountRepo.getCredentials(accountId);
    if (!credentials) {
      throw new Error(`Could not decrypt credentials for account: ${accountId}`);
    }

    const daysBack = this.options.scrapeFromDaysBack ?? 60;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const companyId = PROVIDER_MAP[account.provider];
    if (companyId === undefined) {
      throw new Error(`Unsupported provider: ${account.provider}`);
    }

    const scraper = createScraper({
      companyId,
      startDate,
      combineInstallments: false,
      showBrowser: this.options.showBrowser ?? false,
    });

    const scrapeResult = await scraper.scrape(credentials);
    const now = new Date().toISOString();

    if (!scrapeResult.success) {
      return {
        accountId,
        success: false,
        accounts: [],
        errorType: scrapeResult.errorType,
        errorMessage: scrapeResult.errorMessage,
        scrapedAt: now,
      };
    }

    const resultAccounts = (scrapeResult.accounts ?? []).map((scraperAccount) => {
      const txns = (scraperAccount.txns ?? []).map((txn) => ({
        type: (txn.type === 'installments' ? 'installments' : 'normal') as
          | 'normal'
          | 'installments',
        date: txn.date,
        processedDate: txn.processedDate,
        originalAmount: txn.originalAmount,
        originalCurrency: txn.originalCurrency ?? 'ILS',
        chargedAmount: txn.chargedAmount,
        description: txn.description,
        memo: txn.memo ?? null,
        installmentNumber: txn.installments?.number ?? null,
        installmentTotal: txn.installments?.total ?? null,
        status: (txn.status === 'pending' ? 'pending' : 'completed') as
          | 'completed'
          | 'pending',
        identifier: txn.identifier ?? null,
      }));

      const inserted = this.transactionRepo.upsertBatch(
        accountId,
        scraperAccount.accountNumber,
        txns,
      );

      return {
        accountNumber: scraperAccount.accountNumber,
        balance: scraperAccount.balance ?? null,
        transactionCount: inserted,
      };
    });

    this.accountRepo.updateLastScraped(accountId, now);

    return {
      accountId,
      success: true,
      accounts: resultAccounts,
      scrapedAt: now,
    };
  }

  /** Scrape all configured accounts, returning results for each */
  async scrapeAll(): Promise<ScrapeResult[]> {
    const accounts = this.accountRepo.findAll();
    const results: ScrapeResult[] = [];

    for (const account of accounts) {
      try {
        const result = await this.scrapeAccount(account.id);
        results.push(result);
      } catch (error) {
        results.push({
          accountId: account.id,
          success: false,
          accounts: [],
          errorType: 'UNKNOWN_ERROR',
          errorMessage:
            error instanceof Error ? error.message : 'Unknown error',
          scrapedAt: new Date().toISOString(),
        });
      }
    }

    return results;
  }
}
