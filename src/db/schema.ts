import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  companyId: text('company_id').notNull(),
  displayName: text('display_name').notNull(),
  accountNumber: text('account_number'),
  accountType: text('account_type').notNull().default('bank'),
  balance: real('balance'),
  credentialsRef: text('credentials_ref').notNull(),
  manualLogin: integer('manual_login', { mode: 'boolean' }).notNull().default(false),
  showBrowser: integer('show_browser', { mode: 'boolean' }).notNull().default(false),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  lastScrapedAt: text('last_scraped_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const transactions = sqliteTable('transactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull().references(() => accounts.id),
  identifier: integer('identifier'),
  date: text('date').notNull(),
  processedDate: text('processed_date').notNull(),
  originalAmount: real('original_amount').notNull(),
  originalCurrency: text('original_currency').notNull().default('ILS'),
  chargedAmount: real('charged_amount').notNull(),
  description: text('description').notNull(),
  memo: text('memo'),
  type: text('type').notNull().default('normal'),
  status: text('status').notNull().default('completed'),
  installmentNumber: integer('installment_number'),
  installmentTotal: integer('installment_total'),
  category: text('category'),
  meta: text('meta'),
  ignored: integer('ignored', { mode: 'boolean' }).notNull().default(false),
  hash: text('hash').notNull().unique(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const scrapeSessions = sqliteTable('scrape_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  trigger: text('trigger').notNull(), // 'manual' | 'scheduled' | 'single'
  status: text('status').notNull().default('running'), // 'running' | 'completed' | 'cancelled' | 'error'
  accountIds: text('account_ids').notNull(), // JSON array of target account IDs
  startedAt: text('started_at').notNull().default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
});

export const scrapeLogs = sqliteTable('scrape_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull().references(() => accounts.id),
  sessionId: integer('session_id').references(() => scrapeSessions.id),
  status: text('status').notNull(),
  errorType: text('error_type'),
  errorMessage: text('error_message'),
  transactionsFound: integer('transactions_found').default(0),
  transactionsNew: integer('transactions_new').default(0),
  durationMs: integer('duration_ms'),
  startedAt: text('started_at').notNull().default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
});

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  label: text('label').notNull(),
  color: text('color'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
