import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  memberId: integer('member_id').references(() => members.id),
  companyId: text('company_id').notNull(),
  displayName: text('display_name').notNull(),
  accountNumber: text('account_number'),
  accountType: text('account_type').notNull().default('bank'),
  balance: real('balance'),
  credentialsRef: text('credentials_ref').notNull(),
  manualLogin: integer('manual_login', { mode: 'boolean' }).notNull().default(false),
  showBrowser: integer('show_browser', { mode: 'boolean' }).notNull().default(false),
  manualScrapeOnly: integer('manual_scrape_only', { mode: 'boolean' }).notNull().default(false),
  stalenessDays: integer('staleness_days'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  lastScrapedAt: text('last_scraped_at'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const transactions = sqliteTable(
  'transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id),
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
    expenseOwnerType: text('expense_owner_type').notNull().default('unassigned'),
    expenseOwnerMemberId: integer('expense_owner_member_id').references(() => members.id, {
      onDelete: 'set null',
    }),
    ownerSource: text('owner_source').notNull().default('unassigned'),
    ownerConfidence: real('owner_confidence'),
    ownerReviewReason: text('owner_review_reason'),
    meta: text('meta'),
    ignored: integer('ignored', { mode: 'boolean' }).notNull().default(false),
    needsReview: integer('needs_review', { mode: 'boolean' }).notNull().default(false),
    reviewReason: text('review_reason'),
    confidence: real('confidence'),
    hash: text('hash').notNull().unique(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    scrapeSessionId: integer('scrape_session_id').references(() => scrapeSessions.id),
  },
  (table) => [
    index('idx_transactions_category').on(table.category),
    index('idx_transactions_ignored').on(table.ignored),
    index('idx_transactions_status').on(table.status),
    index('idx_transactions_date').on(table.date),
    index('idx_transactions_account_id').on(table.accountId),
    index('idx_transactions_date_ignored').on(table.date, table.ignored),
    index('idx_transactions_account_date').on(table.accountId, table.date),
    index('idx_transactions_category_date').on(table.category, table.date),
    index('idx_transactions_owner').on(table.expenseOwnerType, table.expenseOwnerMemberId),
    index('idx_transactions_owner_date').on(
      table.expenseOwnerType,
      table.expenseOwnerMemberId,
      table.date,
    ),
    index('idx_transactions_scrape_session_id').on(table.scrapeSessionId),
  ],
);

/**
 * Provider/source identities for transactions. A transaction may have more than one
 * identity (for example, an XLS statement reference and a later scraper movement ID),
 * while each provider namespace is unique for an account.
 */
export const transactionSources = sqliteTable(
  'transaction_sources',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    transactionId: integer('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    externalId: text('external_id').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex('idx_transaction_sources_account_source_external').on(
      table.accountId,
      table.source,
      table.externalId,
    ),
    index('idx_transaction_sources_transaction').on(table.transactionId),
    index('idx_transaction_sources_account').on(table.accountId),
  ],
);

export const members = sqliteTable('members', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const scrapeSessions = sqliteTable('scrape_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  trigger: text('trigger').notNull(), // 'manual' | 'scheduled' | 'single'
  status: text('status').notNull().default('running'), // 'running' | 'completed' | 'cancelled' | 'error'
  accountIds: text('account_ids').notNull(), // JSON array of target account IDs
  startedAt: text('started_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
});

export const scrapeLogs = sqliteTable('scrape_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id),
  sessionId: integer('session_id').references(() => scrapeSessions.id),
  status: text('status').notNull(),
  errorType: text('error_type'),
  errorMessage: text('error_message'),
  transactionsFound: integer('transactions_found').default(0),
  transactionsNew: integer('transactions_new').default(0),
  durationMs: integer('duration_ms'),
  startedAt: text('started_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
});

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  label: text('label').notNull(),
  color: text('color'),
  rules: text('rules'),
  defaultOwnerType: text('default_owner_type').notNull().default('unassigned'),
  defaultOwnerMemberId: integer('default_owner_member_id').references(() => members.id, {
    onDelete: 'set null',
  }),
  ignoredFromStats: integer('ignored_from_stats', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const ownershipRules = sqliteTable(
  'ownership_rules',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    priority: integer('priority').notNull().default(100),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    accountId: integer('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    accountMemberId: integer('account_member_id').references(() => members.id, {
      onDelete: 'set null',
    }),
    categoryName: text('category_name'),
    descriptionContains: text('description_contains'),
    minAmount: real('min_amount'),
    maxAmount: real('max_amount'),
    targetOwnerType: text('target_owner_type').notNull(),
    targetOwnerMemberId: integer('target_owner_member_id').references(() => members.id, {
      onDelete: 'set null',
    }),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_ownership_rules_enabled_priority').on(table.enabled, table.priority),
    index('idx_ownership_rules_account').on(table.accountId),
    index('idx_ownership_rules_account_member').on(table.accountMemberId),
    index('idx_ownership_rules_category').on(table.categoryName),
  ],
);

export const assets = sqliteTable('assets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  type: text('type').notNull(),
  institution: text('institution'),
  currency: text('currency').notNull().default('ILS'),
  liquidity: text('liquidity').notNull().default('liquid'),
  linkedAccountId: integer('linked_account_id').references(() => accounts.id, {
    onDelete: 'set null',
  }),
  notes: text('notes'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const holdings = sqliteTable(
  'holdings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').notNull(),
    currency: text('currency').notNull(),
    quantity: real('quantity').notNull().default(0),
    costBasis: real('cost_basis').notNull().default(0),
    lastPrice: real('last_price'),
    lastPriceDate: text('last_price_date'),
    notes: text('notes'),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [uniqueIndex('idx_holdings_asset_name').on(table.assetId, table.name)],
);

export const assetMovements = sqliteTable('asset_movements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  assetId: integer('asset_id')
    .notNull()
    .references(() => assets.id, { onDelete: 'cascade' }),
  holdingId: integer('holding_id').references(() => holdings.id, { onDelete: 'set null' }),
  date: text('date').notNull(),
  type: text('type').notNull(),
  quantity: real('quantity').notNull(),
  currency: text('currency').notNull(),
  pricePerUnit: real('price_per_unit'),
  sourceAmount: real('source_amount'),
  sourceCurrency: text('source_currency'),
  notes: text('notes'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const assetSnapshots = sqliteTable(
  'asset_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    holdingsSnapshot: text('holdings_snapshot'),
    totalValue: real('total_value'),
    totalValueIls: real('total_value_ils').notNull(),
    exchangeRates: text('exchange_rates'),
    notes: text('notes'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [uniqueIndex('idx_asset_snapshots_asset_date').on(table.assetId, table.date)],
);

export const accountBalanceHistory = sqliteTable(
  'account_balance_history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id),
    date: text('date').notNull(),
    balance: real('balance').notNull(),
  },
  (table) => [
    uniqueIndex('idx_account_balance_history_account_date').on(table.accountId, table.date),
  ],
);

export const budgets = sqliteTable('budgets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  amount: real('amount').notNull(),
  period: text('period').notNull().default('monthly'), // 'monthly' | 'yearly'
  categoryNames: text('category_names').notNull().default('[]'), // JSON array of category name strings
  alertThreshold: integer('alert_threshold').notNull().default(80),
  alertEnabled: integer('alert_enabled', { mode: 'boolean' }).notNull().default(true),
  color: text('color'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const liabilities = sqliteTable('liabilities', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  type: text('type').notNull(),
  currency: text('currency').notNull().default('ILS'),
  originalAmount: real('original_amount').notNull(),
  currentBalance: real('current_balance').notNull(),
  interestRate: real('interest_rate'),
  startDate: text('start_date'),
  notes: text('notes'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});
