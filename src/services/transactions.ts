import { and, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts, transactions } from '../db/schema.js';
import { searchTransactionIds } from '../db/queries.js';
import { isCategoryIgnored } from './categories.js';

// ── Filter builder (moved from helpers.ts) ──

export interface TransactionFilterParams {
  accountType?: string;
  accountId?: number;
  startDate?: string;
  endDate?: string;
}

export interface TransactionFilterResult {
  conditions: SQL[];
  empty: boolean;
}

export function buildTransactionFilters(params: TransactionFilterParams): TransactionFilterResult {
  const conditions: SQL[] = [];

  if (params.accountType) {
    const cond = accountTypeCondition(params.accountType);
    if (!cond) return { conditions: [], empty: true };
    conditions.push(cond);
  }
  if (params.accountId !== undefined) {
    conditions.push(eq(transactions.accountId, params.accountId));
  }
  if (params.startDate) {
    conditions.push(gte(transactions.date, params.startDate));
  }
  if (params.endDate) {
    conditions.push(lte(transactions.date, params.endDate));
  }

  return { conditions, empty: false };
}

function accountTypeCondition(accountType: string): SQL | null {
  const ids = db.select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.accountType, accountType))
    .all()
    .map(a => a.id);
  return ids.length > 0 ? inArray(transactions.accountId, ids) : null;
}

// ── Reads ──

export interface ListTransactionsOpts {
  offset?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface ListTransactionsFilters extends TransactionFilterParams {
  category?: string;
  status?: string;
  needsReview?: boolean;
  minAmount?: number;
  maxAmount?: number;
  search?: string;
}

export function listTransactions(filters: ListTransactionsFilters, opts: ListTransactionsOpts = {}) {
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 50;

  const { conditions, empty } = buildTransactionFilters(filters);
  if (empty) return { transactions: [] as typeof rows, pagination: { total: 0, offset, limit, hasMore: false } };

  if (filters.category) conditions.push(eq(transactions.category, filters.category));
  if (filters.status) conditions.push(eq(transactions.status, filters.status));
  if (filters.needsReview !== undefined) conditions.push(eq(transactions.needsReview, filters.needsReview));
  if (filters.minAmount !== undefined) conditions.push(gte(transactions.chargedAmount, filters.minAmount));
  if (filters.maxAmount !== undefined) conditions.push(lte(transactions.chargedAmount, filters.maxAmount));
  if (filters.search) {
    const ftsIds = searchTransactionIds(filters.search);
    if (ftsIds.length === 0) {
      return { transactions: [] as typeof rows, pagination: { total: 0, offset, limit, hasMore: false } };
    }
    conditions.push(inArray(transactions.id, ftsIds));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = db.select({ total: count() }).from(transactions).where(where).all();

  const sortColumn = opts.sortBy === 'chargedAmount' ? transactions.chargedAmount
    : opts.sortBy === 'description' ? transactions.description
    : opts.sortBy === 'processedDate' ? transactions.processedDate
    : transactions.date;

  const orderFn = opts.sortOrder === 'asc' ? sql`${sortColumn} asc` : desc(sortColumn);

  const rows = db.select().from(transactions)
    .where(where)
    .orderBy(orderFn)
    .limit(limit)
    .offset(offset)
    .all();

  return {
    transactions: rows,
    pagination: { total, offset, limit, hasMore: offset + limit < total },
  };
}

export function getNeedsReviewCount(): number {
  const [{ total }] = db.select({ total: count() })
    .from(transactions)
    .where(eq(transactions.needsReview, true))
    .all();
  return total;
}

// ── Writes ──

export function resolveReview(id: number, category: string) {
  const [updated] = db.update(transactions)
    .set({ category, needsReview: false, reviewReason: null, ignored: isCategoryIgnored(category) })
    .where(eq(transactions.id, id))
    .returning()
    .all();
  return updated ?? null;
}

export function setTransactionIgnored(id: number, ignored: boolean) {
  const [updated] = db.update(transactions)
    .set({ ignored })
    .where(eq(transactions.id, id))
    .returning()
    .all();
  return updated ?? null;
}

export function updateTransactionCategory(id: number, category: string | null) {
  const [updated] = db.update(transactions)
    .set({ category, needsReview: false, reviewReason: null, ignored: isCategoryIgnored(category) })
    .where(eq(transactions.id, id))
    .returning()
    .all();
  return updated ?? null;
}

export function categorizeTransaction(input: {
  transactionId: number;
  category: string;
  confidence?: number;
  reviewReason?: string;
}) {
  const existing = db.select({ id: transactions.id }).from(transactions)
    .where(eq(transactions.id, input.transactionId)).get();
  if (!existing) return { ok: false as const, error: 'Transaction not found', status: 404 };

  const needsReview = input.confidence !== undefined && input.confidence < 0.8;

  db.update(transactions)
    .set({
      category: input.category,
      confidence: input.confidence ?? null,
      needsReview,
      reviewReason: needsReview ? (input.reviewReason ?? 'Low confidence categorization') : null,
      ignored: isCategoryIgnored(input.category),
    })
    .where(eq(transactions.id, input.transactionId))
    .run();

  return { ok: true as const, transactionId: input.transactionId, category: input.category };
}
