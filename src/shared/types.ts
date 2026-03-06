import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import type { accounts, transactions, scrapeLogs, scrapeSessions } from '../db/schema.js';

// DB row types
export type Account = InferSelectModel<typeof accounts>;
export type NewAccount = InferInsertModel<typeof accounts>;
export type Transaction = InferSelectModel<typeof transactions>;
export type NewTransaction = InferInsertModel<typeof transactions>;
export type ScrapeLog = InferSelectModel<typeof scrapeLogs>;
export type NewScrapeLog = InferInsertModel<typeof scrapeLogs>;
export type ScrapeSession = InferSelectModel<typeof scrapeSessions>;
export type NewScrapeSession = InferInsertModel<typeof scrapeSessions>;

// Scraper result types (from israeli-bank-scrapers)
export interface ScraperTransaction {
  type: string;
  identifier?: number | string;
  date: string;
  processedDate: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  description: string;
  memo?: string;
  installments?: {
    number: number;
    total: number;
  };
  status: string;
  category?: string;
}

export interface ScraperAccountResult {
  accountNumber: string;
  balance?: number;
  txns: ScraperTransaction[];
}

export interface ScraperResult {
  success: boolean;
  accounts?: ScraperAccountResult[];
  errorType?: string;
  errorMessage?: string;
}

// Net worth type enums
export const ASSET_TYPES = ['brokerage', 'pension', 'keren_hishtalmut', 'crypto', 'fund', 'real_estate'] as const;
export const LIQUIDITY_TYPES = ['liquid', 'restricted', 'locked'] as const;
export const HOLDING_TYPES = ['stock', 'etf', 'cash', 'fund_units', 'crypto', 'balance'] as const;
export const MOVEMENT_TYPES = ['deposit', 'withdrawal', 'buy', 'sell', 'dividend', 'fee', 'adjustment', 'contribution', 'rent_income'] as const;

export type AssetCategory = 'simple_value' | 'real_estate' | 'crypto' | 'brokerage';

const ASSET_CATEGORY_MAP: Record<string, AssetCategory> = {
  pension: 'simple_value',
  keren_hishtalmut: 'simple_value',
  fund: 'simple_value',
  real_estate: 'real_estate',
  crypto: 'crypto',
  brokerage: 'brokerage',
};

export function getAssetCategory(assetType: string): AssetCategory {
  return ASSET_CATEGORY_MAP[assetType] ?? 'simple_value';
}

// Movement types allowed per category
export const CATEGORY_MOVEMENT_TYPES: Record<AssetCategory, readonly string[]> = {
  simple_value: ['contribution'],
  real_estate: ['rent_income'],
  crypto: ['buy', 'sell'],
  brokerage: ['deposit', 'withdrawal', 'buy', 'sell', 'dividend'],
};
export const LIABILITY_TYPES = ['loan', 'mortgage', 'credit_line', 'other'] as const;

// Supported company IDs (from israeli-bank-scrapers CompanyTypes)
export const COMPANY_IDS = [
  'hapoalim', 'leumi', 'discount', 'mizrahi', 'otsarHahayal',
  'mercantile', 'massad', 'beinleumi', 'union',
  'isracard', 'amex', 'max', 'visaCal',
  'beyahadBishvilha', 'yahav', 'oneZero', 'behatsdaa', 'pagi',
] as const;

export type CompanyId = typeof COMPANY_IDS[number];

export type AccountType = 'bank' | 'credit_card';

export const ACCOUNT_TYPE_MAP: Record<CompanyId, AccountType> = {
  hapoalim: 'bank',
  leumi: 'bank',
  discount: 'bank',
  mizrahi: 'bank',
  otsarHahayal: 'bank',
  mercantile: 'bank',
  massad: 'bank',
  beinleumi: 'bank',
  union: 'bank',
  yahav: 'bank',
  oneZero: 'bank',
  isracard: 'credit_card',
  amex: 'credit_card',
  max: 'credit_card',
  visaCal: 'credit_card',
  beyahadBishvilha: 'credit_card',
  behatsdaa: 'credit_card',
  pagi: 'credit_card',
};

export function getAccountType(companyId: CompanyId): AccountType {
  return ACCOUNT_TYPE_MAP[companyId];
}

export interface TransactionMeta {
  bankCategory?: string;
}

export function parseMeta(raw: string | null): TransactionMeta {
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { return {}; }
}
