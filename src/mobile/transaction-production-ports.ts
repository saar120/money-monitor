import { and, desc, eq, gt, gte, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { MobileBootstrapSectionReadError } from './bootstrap-adapter.js';
import {
  boundedMobileText,
  maskAccountIdentifier,
  projectMobileMoney,
  projectMobileTransactionDirection,
  projectMobileTransactionStatus,
} from './mobile-transaction-projection.js';
import { createMobilePublicIdProjector } from './mobile-public-id.js';
import {
  canonicalTransactionFilterFingerprint,
  createMobileTransactionCursorCodec,
  type MobileTransactionCursorPosition,
} from './transaction-cursor.js';
import type {
  MobileTransactionDetail,
  MobileTransactionListEnvelope,
  MobileTransactionItem,
  MobileTransactionQuery,
} from './transaction-contract.js';
import type { MobileTransactionReadContext } from './transaction-routes.js';

type MoneyMonitorDatabase = BetterSQLite3Database<typeof schema>;
type MobileTransactionListData = MobileTransactionListEnvelope['data'];

export interface ProductionMobileTransactionPortOptions {
  db: MoneyMonitorDatabase;
  publicIdKey: string;
}

export interface ProductionMobileTransactionPorts {
  list(
    query: Readonly<MobileTransactionQuery>,
    context: Readonly<MobileTransactionReadContext>,
  ): MobileTransactionListData;
  detail(
    publicId: string,
    context: Readonly<MobileTransactionReadContext>,
  ): MobileTransactionDetail | null;
}

interface ProjectableTransactionRow {
  transactionId: number;
  occurredOn: string;
  description: string;
  chargedAmount: number;
  chargedCurrency: string;
  transactionStatus: string;
  categoryName: string | null;
  categoryId: number | null;
  categoryLabel: string | null;
  accountId: number | null;
  accountName: string | null;
  accountNumber: string | null;
  needsReview: boolean;
  ignored: boolean;
}

function financialDate(value: string): string {
  const candidate = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    throw new MobileBootstrapSectionReadError('source_unavailable', false);
  }
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate) {
    throw new MobileBootstrapSectionReadError('source_unavailable', false);
  }
  return candidate;
}

function literalSearchExpression(query: string): string | null {
  const tokens =
    query
      .normalize('NFKC')
      .match(/[\p{L}\p{N}]+/gu)
      ?.slice(0, 12) ?? [];
  if (tokens.length === 0) return null;
  return `description : (${tokens.map((token) => `"${token}"*`).join(' AND ')})`;
}

export function createProductionMobileTransactionPorts(
  options: ProductionMobileTransactionPortOptions,
): ProductionMobileTransactionPorts {
  const publicId = createMobilePublicIdProjector(options.publicIdKey);
  const cursorCodec = createMobileTransactionCursorCodec(options.publicIdKey);
  const transactionIdsByPublicId = new Map<string, number>();
  let highestMappedTransactionId = 0;

  function projectRow(row: ProjectableTransactionRow): MobileTransactionItem {
    if (row.accountId === null || row.accountName === null) {
      throw new MobileBootstrapSectionReadError('source_unavailable', false);
    }
    return {
      id: publicId('transaction', row.transactionId),
      occurredOn: financialDate(row.occurredOn),
      displayName: boundedMobileText(row.description, 'Transaction', 160),
      amount: projectMobileMoney(Math.abs(row.chargedAmount), row.chargedCurrency),
      direction: projectMobileTransactionDirection(row.chargedAmount),
      status: projectMobileTransactionStatus(row.transactionStatus),
      category:
        row.categoryName && row.categoryId !== null
          ? {
              id: publicId('category', row.categoryId),
              label: boundedMobileText(row.categoryLabel ?? row.categoryName, 'Category', 80),
            }
          : null,
      account: {
        id: publicId('account', row.accountId),
        displayName: boundedMobileText(row.accountName, 'Account', 80),
        identifierMask: maskAccountIdentifier(row.accountNumber),
      },
      needsReview: row.needsReview,
      excludedFromReports: row.ignored,
    };
  }

  function localAccountId(publicAccountId: string): number | null {
    const rows = options.db.select({ id: schema.accounts.id }).from(schema.accounts).all();
    return rows.find((row) => publicId('account', row.id) === publicAccountId)?.id ?? null;
  }

  function refreshTransactionIdMap(): void {
    const rows = options.db
      .select({ id: schema.transactions.id })
      .from(schema.transactions)
      .where(gt(schema.transactions.id, highestMappedTransactionId))
      .orderBy(schema.transactions.id)
      .all();
    for (const row of rows) {
      transactionIdsByPublicId.set(publicId('transaction', row.id), row.id);
      highestMappedTransactionId = Math.max(highestMappedTransactionId, row.id);
    }
  }

  function localTransactionId(publicTransactionId: string): number | null {
    const known = transactionIdsByPublicId.get(publicTransactionId);
    if (known !== undefined) return known;
    refreshTransactionIdMap();
    return transactionIdsByPublicId.get(publicTransactionId) ?? null;
  }

  const selection = {
    transactionId: schema.transactions.id,
    occurredOn: schema.transactions.date,
    description: schema.transactions.description,
    chargedAmount: schema.transactions.chargedAmount,
    chargedCurrency: schema.transactions.chargedCurrency,
    transactionStatus: schema.transactions.status,
    categoryName: schema.transactions.category,
    categoryId: schema.categories.id,
    categoryLabel: schema.categories.label,
    accountId: schema.accounts.id,
    accountName: schema.accounts.displayName,
    accountNumber: schema.accounts.accountNumber,
    needsReview: schema.transactions.needsReview,
    ignored: schema.transactions.ignored,
  };

  function list(
    query: Readonly<MobileTransactionQuery>,
    context: Readonly<MobileTransactionReadContext>,
  ): MobileTransactionListData {
    const fingerprint = canonicalTransactionFilterFingerprint(query);
    const binding = { filterFingerprint: fingerprint, financialDate: context.financialDate };
    let cursor: MobileTransactionCursorPosition | null = null;
    if (query.cursor) cursor = cursorCodec.decode(query.cursor, binding);
    const snapshotCeilingId =
      cursor?.snapshotCeilingId ??
      options.db
        .select({ value: sql<number>`COALESCE(MAX(${schema.transactions.id}), 0)` })
        .from(schema.transactions)
        .get()?.value ??
      0;

    const conditions: SQL[] = [
      lte(schema.transactions.date, context.financialDate),
      lte(schema.transactions.id, snapshotCeilingId),
    ];
    if (query.startDate) conditions.push(gte(schema.transactions.date, query.startDate));
    if (query.endDate) conditions.push(lte(schema.transactions.date, query.endDate));
    if (!query.includeExcluded) conditions.push(eq(schema.transactions.ignored, false));
    if (query.needsReview !== undefined) {
      conditions.push(eq(schema.transactions.needsReview, query.needsReview));
    }
    if (query.direction === 'debit') conditions.push(lt(schema.transactions.chargedAmount, 0));
    if (query.direction === 'credit') conditions.push(gt(schema.transactions.chargedAmount, 0));
    if (query.direction === 'unknown') conditions.push(eq(schema.transactions.chargedAmount, 0));
    if (query.status === 'posted') conditions.push(eq(schema.transactions.status, 'completed'));
    if (query.status === 'pending') conditions.push(eq(schema.transactions.status, 'pending'));
    if (query.status === 'unknown') {
      conditions.push(sql`${schema.transactions.status} NOT IN ('completed', 'pending')`);
    }
    if (query.accountId) {
      const accountId = localAccountId(query.accountId);
      if (accountId === null) {
        return {
          financialDate: context.financialDate,
          transactions: [],
          page: { hasMore: false, nextCursor: null },
        };
      }
      conditions.push(eq(schema.transactions.accountId, accountId));
    }
    if (query.q) {
      const expression = literalSearchExpression(query.q);
      if (expression === null) {
        return {
          financialDate: context.financialDate,
          transactions: [],
          page: { hasMore: false, nextCursor: null },
        };
      }
      conditions.push(
        sql`${schema.transactions.id} IN (
          SELECT rowid FROM transactions_fts WHERE transactions_fts MATCH ${expression}
        )`,
      );
    }
    if (cursor) {
      conditions.push(
        or(
          lt(schema.transactions.date, cursor.date),
          and(eq(schema.transactions.date, cursor.date), lt(schema.transactions.id, cursor.id)),
        ) as SQL,
      );
    }

    const rows = options.db
      .select(selection)
      .from(schema.transactions)
      .leftJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
      .leftJoin(schema.categories, eq(schema.transactions.category, schema.categories.name))
      .where(and(...conditions))
      .orderBy(desc(schema.transactions.date), desc(schema.transactions.id))
      .limit(query.limit + 1)
      .all();
    const hasMore = rows.length > query.limit;
    const pageRows = rows.slice(0, query.limit);
    const lastRow = pageRows.at(-1);
    return {
      financialDate: context.financialDate,
      transactions: pageRows.map(projectRow),
      page: {
        hasMore,
        nextCursor:
          hasMore && lastRow
            ? cursorCodec.encode(
                {
                  date: financialDate(lastRow.occurredOn),
                  id: lastRow.transactionId,
                  snapshotCeilingId,
                },
                binding,
              )
            : null,
      },
    };
  }

  function detail(
    publicTransactionId: string,
    context: Readonly<MobileTransactionReadContext>,
  ): MobileTransactionDetail | null {
    const transactionId = localTransactionId(publicTransactionId);
    if (transactionId === null) return null;
    const row = options.db
      .select({
        ...selection,
        ownerType: schema.transactions.expenseOwnerType,
        ownerName: schema.members.name,
      })
      .from(schema.transactions)
      .leftJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
      .leftJoin(schema.categories, eq(schema.transactions.category, schema.categories.name))
      .leftJoin(schema.members, eq(schema.transactions.expenseOwnerMemberId, schema.members.id))
      .where(
        and(
          eq(schema.transactions.id, transactionId),
          lte(schema.transactions.date, context.financialDate),
        ),
      )
      .get();
    if (!row) {
      transactionIdsByPublicId.delete(publicTransactionId);
      return null;
    }

    const item = projectRow(row);
    const owner: MobileTransactionDetail['owner'] =
      row.ownerType === 'member' && row.ownerName
        ? { kind: 'member', displayName: boundedMobileText(row.ownerName, 'Member', 80) }
        : row.ownerType === 'shared'
          ? { kind: 'shared', displayName: null }
          : row.ownerType === 'unassigned'
            ? { kind: 'unassigned', displayName: null }
            : { kind: 'unknown', displayName: null };
    return { ...item, owner };
  }

  return Object.freeze({ list, detail });
}
