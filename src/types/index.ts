/**
 * Shared type definitions for the money-monitor application.
 *
 * These types are the internal domain model — the scraper library's types
 * are mapped into these when storing/querying data.
 */

/** Supported financial providers (maps to israeli-bank-scrapers CompanyTypes) */
export type ProviderType =
  | 'hapoalim'
  | 'beinleumi'
  | 'union'
  | 'amex'
  | 'isracard'
  | 'visaCal'
  | 'max'
  | 'otsarHahayal'
  | 'discount'
  | 'mercantile'
  | 'mizrahi'
  | 'leumi'
  | 'massad'
  | 'yahav'
  | 'behatsdaa'
  | 'beyahadBishvilha'
  | 'oneZero'
  | 'pagi';

/** Stored account configuration */
export interface Account {
  id: string;
  name: string;
  provider: ProviderType;
  /** Encrypted JSON blob of provider-specific credentials */
  encryptedCredentials: string;
  createdAt: string;
  updatedAt: string;
  lastScrapedAt: string | null;
}

export type TransactionType = 'normal' | 'installments';
export type TransactionStatus = 'completed' | 'pending';

/** A normalized transaction stored in our database */
export interface Transaction {
  id: string;
  accountId: string;
  providerAccountNumber: string;
  type: TransactionType;
  date: string;
  processedDate: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  description: string;
  memo: string | null;
  category: string | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
  status: TransactionStatus;
  identifier: number | null;
  scrapedAt: string;
}

/** Result of a single account scrape */
export interface ScrapeAccountResult {
  accountNumber: string;
  balance: number | null;
  transactionCount: number;
}

export interface ScrapeResult {
  accountId: string;
  success: boolean;
  accounts: ScrapeAccountResult[];
  errorType?: string;
  errorMessage?: string;
  scrapedAt: string;
}

/** Query filters for retrieving transactions */
export interface TransactionFilters {
  accountId?: string;
  startDate?: string;
  endDate?: string;
  category?: string;
  status?: TransactionStatus;
  minAmount?: number;
  maxAmount?: number;
  description?: string;
  limit?: number;
  offset?: number;
}

/** Summary statistics for a set of transactions */
export interface TransactionSummary {
  totalIncome: number;
  totalExpenses: number;
  netAmount: number;
  transactionCount: number;
  byCategory: Record<string, number>;
  byCurrency: Record<string, number>;
  byMonth: Record<string, { income: number; expenses: number }>;
}

/** The shape of credentials needed per provider */
export interface ProviderCredentials {
  /** Most providers need userCode / username */
  username?: string;
  /** Password for bank login */
  password?: string;
  /** Some providers need a card number (e.g., Isracard, Max, Amex) */
  card6Digits?: string;
  /** National ID for some providers */
  nationalID?: string;
  /** OTP long-term token for 2FA providers */
  otpLongTermToken?: string;
}

/** API response wrapper */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
