import { FinancialCommandError } from './financial-command.js';
import { commandTransaction as applyTransactionCommand } from './transaction-command.js';
import { and, count, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { accounts, transactions } from '../db/schema.js';
import { searchTransactionIds } from '../db/queries.js';
import { ownerFilterConditions } from './ownership.js';
import type { OwnerType } from '../shared/types.js';

// ── Filter builder (moved from helpers.ts) ──

export interface TransactionFilterParams {
  accountType?: string;
  accountId?: number;
  category?: string;
  startDate?: string;
  endDate?: string;
  expensesOnly?: boolean;
  ownerType?: OwnerType | 'all';
  ownerMemberId?: number;
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
  if (params.category) {
    conditions.push(
      params.category === 'uncategorized'
        ? sql`COALESCE(${transactions.category}, 'uncategorized') = 'uncategorized'`
        : eq(transactions.category, params.category),
    );
  }
  if (params.startDate) {
    conditions.push(gte(transactions.reportingDate, params.startDate));
  }
  if (params.endDate) {
    conditions.push(lte(transactions.reportingDate, params.endDate));
  }
  if (params.expensesOnly) {
    conditions.push(lt(transactions.chargedAmount, 0));
  }
  conditions.push(
    ...ownerFilterConditions({
      ownerType: params.ownerType,
      ownerMemberId: params.ownerMemberId,
    }),
  );

  return { conditions, empty: false };
}

function accountTypeCondition(accountType: string): SQL | null {
  const ids = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.accountType, accountType))
    .all()
    .map((a) => a.id);
  return ids.length > 0 ? inArray(transactions.accountId, ids) : null;
}

// ── Reads ──

export function getTransactionById(id: number) {
  return db.select().from(transactions).where(eq(transactions.id, id)).get() ?? null;
}

export function getActivitySince(since: string) {
  const row = db
    .select({
      transactions: sql<number>`COUNT(*)`,
      spent: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.chargedAmount} < 0 THEN ABS(${transactions.chargedAmount}) ELSE 0 END), 0)`,
    })
    .from(transactions)
    .where(sql`datetime(${transactions.createdAt}) >= datetime(${since})`)
    .get();
  return { transactions: row?.transactions ?? 0, spent: row?.spent ?? 0 };
}

export interface ListTransactionsOpts {
  offset?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface ListTransactionsFilters extends TransactionFilterParams {
  status?: string;
  needsReview?: boolean;
  ignored?: boolean;
  minAmount?: number;
  maxAmount?: number;
  search?: string;
}

export function listTransactions(
  filters: ListTransactionsFilters,
  opts: ListTransactionsOpts = {},
) {
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 50;

  const { conditions, empty } = buildTransactionFilters(filters);
  if (empty)
    return {
      transactions: [] as typeof rows,
      pagination: { total: 0, offset, limit, hasMore: false },
    };

  if (filters.status) conditions.push(eq(transactions.status, filters.status));
  if (filters.needsReview !== undefined)
    conditions.push(eq(transactions.needsReview, filters.needsReview));
  if (filters.ignored !== undefined) conditions.push(eq(transactions.ignored, filters.ignored));
  if (filters.minAmount !== undefined)
    conditions.push(gte(transactions.chargedAmount, filters.minAmount));
  if (filters.maxAmount !== undefined)
    conditions.push(lte(transactions.chargedAmount, filters.maxAmount));
  if (filters.search) {
    const ftsIds = searchTransactionIds(filters.search);
    if (ftsIds.length === 0) {
      return {
        transactions: [] as typeof rows,
        pagination: { total: 0, offset, limit, hasMore: false },
      };
    }
    conditions.push(inArray(transactions.id, ftsIds));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = db.select({ total: count() }).from(transactions).where(where).all();

  const sortColumn =
    opts.sortBy === 'chargedAmount'
      ? transactions.chargedAmount
      : opts.sortBy === 'description'
        ? transactions.description
        : opts.sortBy === 'processedDate'
          ? transactions.processedDate
          : transactions.reportingDate;

  const orderFn = opts.sortOrder === 'asc' ? sql`${sortColumn} asc` : desc(sortColumn);

  const rows = db
    .select()
    .from(transactions)
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
  const [{ total }] = db
    .select({ total: count() })
    .from(transactions)
    .where(eq(transactions.needsReview, true))
    .all();
  return total;
}

// ── Writes ──

export function categorizeTransaction(input: {
  transactionId: number;
  category: string;
  confidence?: number;
  reviewReason?: string;
  commandId?: string;
  expectedVersion?: number;
}) {
  if (!input.commandId || input.expectedVersion === undefined)
    return { ok: false as const, error: 'update_required', status: 426 };
  try {
    const outcome = applyTransactionCommand(
      input.transactionId,
      {
        commandId: input.commandId,
        expectedVersion: input.expectedVersion,
        patch: {
          category: input.category,
          confidence: input.confidence,
          reviewReason: input.reviewReason,
        },
      },
      'financial-tools',
      db,
    );
    return {
      ok: true as const,
      transactionId: outcome.transaction.id,
      category: outcome.transaction.category,
      resourceVersion: outcome.transaction.resourceVersion,
      commandId: outcome.commandId,
    };
  } catch (cause) {
    if (cause instanceof FinancialCommandError)
      return { ok: false as const, error: cause.code, status: cause.status };
    throw cause;
  }
}

export { transactionCommandSchema } from './transaction-command.js';
export function commandTransaction(id: number, input: unknown, clientId: string) {
  return applyTransactionCommand(id, input, clientId, db);
}
