import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { createMobilePublicIdProjector } from '../../mobile/mobile-public-id.js';
import {
  boundedMobileText,
  maskAccountIdentifier,
  projectMobileMoney,
  projectMobileTransactionDirection,
  projectMobileTransactionStatus,
} from '../../mobile/mobile-transaction-projection.js';
import type { TransactionListQuery, TransactionResource } from './contract.js';

const CURSOR_PREFIX = 'cursor_v2_';
const CURSOR_AAD = Buffer.from('money-monitor/canonical-transactions/cursor/v2');

interface CursorPayload {
  version: 2;
  lastSortValue: string | number;
  lastId: number;
  snapshotCeilingId: number;
  snapshotDigest: string;
  fingerprint: string;
  financialDate: string;
}

interface TransactionRow {
  transactionId: number;
  occurredOn: string;
  processedOn: string;
  description: string;
  chargedAmount: number;
  chargedCurrency: string;
  transactionStatus: string;
  categoryName: string | null;
  categoryId: number | null;
  categoryLabel: string | null;
  accountId: number;
  accountName: string;
  accountNumber: string | null;
  accountType: string;
  ownerType: string;
  ownerMemberId: number | null;
  ownerName: string | null;
  needsReview: number;
  reviewReason: string | null;
  confidence: number | null;
  ignored: number;
}

function validFinancialDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function fingerprint(query: TransactionListQuery): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        q: query.q ?? null,
        startDate: query.startDate ?? null,
        endDate: query.endDate ?? null,
        direction: query.direction ?? null,
        status: query.status ?? null,
        needsReview: query.needsReview ?? null,
        includeExcluded: query.includeExcluded,
        accountId: query.accountId ?? null,
        accountType: query.accountType ?? null,
        category: query.category ?? null,
        ownerType: query.ownerType ?? null,
        ownerMemberId: query.ownerMemberId ?? null,
        minAmount: query.minAmount ?? null,
        maxAmount: query.maxAmount ?? null,
        limit: query.limit,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      }),
    )
    .digest('hex');
}

function cursorCodec(secret: string) {
  if (secret.length < 32) throw new Error('Transaction cursor key must contain 32 characters');
  const key = createHash('sha256').update('canonical-transactions\0').update(secret).digest();

  return {
    encode(payload: CursorPayload): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(CURSOR_AAD);
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(payload), 'utf8'),
        cipher.final(),
      ]);
      return `${CURSOR_PREFIX}${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')}`;
    },
    decode(value: string, expectedFingerprint: string, financialDate: string): CursorPayload {
      try {
        if (!value.startsWith(CURSOR_PREFIX) || value.length > 512) throw new Error();
        const bytes = Buffer.from(value.slice(CURSOR_PREFIX.length), 'base64url');
        if (bytes.length <= 28) throw new Error();
        const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
        decipher.setAAD(CURSOR_AAD);
        decipher.setAuthTag(bytes.subarray(12, 28));
        const payload = JSON.parse(
          Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'),
        ) as CursorPayload;
        if (
          payload.version !== 2 ||
          !['string', 'number'].includes(typeof payload.lastSortValue) ||
          (typeof payload.lastSortValue === 'number' && !Number.isFinite(payload.lastSortValue)) ||
          (typeof payload.lastSortValue === 'string' && payload.lastSortValue.length > 512) ||
          !Number.isSafeInteger(payload.lastId) ||
          payload.lastId < 1 ||
          !Number.isSafeInteger(payload.snapshotCeilingId) ||
          payload.snapshotCeilingId < 0 ||
          !/^[a-f0-9]{64}$/.test(payload.snapshotDigest) ||
          payload.fingerprint !== expectedFingerprint ||
          payload.financialDate !== financialDate
        ) {
          throw new Error();
        }
        return payload;
      } catch {
        throw new InvalidTransactionCursorError();
      }
    },
  };
}

export class InvalidTransactionCursorError extends Error {}

export class CanonicalTransactionStore {
  private readonly publicId: ReturnType<typeof createMobilePublicIdProjector>;
  private readonly cursors: ReturnType<typeof cursorCodec>;

  constructor(
    private readonly sqlite: Database.Database,
    publicIdKey: string,
  ) {
    this.publicId = createMobilePublicIdProjector(publicIdKey);
    this.cursors = cursorCodec(publicIdKey);
  }

  list(query: TransactionListQuery, financialDate: string) {
    if (!validFinancialDate(financialDate)) throw new Error('Invalid financial date');
    const queryFingerprint = fingerprint(query);
    const decoded = query.cursor
      ? this.cursors.decode(query.cursor, queryFingerprint, financialDate)
      : null;
    const snapshotCeilingId =
      decoded?.snapshotCeilingId ??
      (
        this.sqlite.prepare('SELECT COALESCE(MAX(id), 0) AS value FROM transactions').get() as {
          value: number;
        }
      ).value;
    const snapshotDigest = this.snapshotDigest(snapshotCeilingId);
    if (decoded && decoded.snapshotDigest !== snapshotDigest) {
      throw new InvalidTransactionCursorError();
    }
    const { where, values } = this.filters(query, financialDate, snapshotCeilingId);
    const total = (
      this.sqlite
        .prepare(
          `SELECT COUNT(*) AS value FROM transactions t JOIN accounts a ON a.id = t.account_id ${where}`,
        )
        .get(...values) as {
        value: number;
      }
    ).value;
    const orderColumns: Record<TransactionListQuery['sortBy'], string> = {
      date: 't.date',
      processedDate: 't.processed_date',
      amount: 'ABS(t.charged_amount)',
      description: 't.description COLLATE NOCASE',
    };
    const direction = query.sortOrder === 'asc' ? 'ASC' : 'DESC';
    const seekOperator = query.sortOrder === 'asc' ? '>' : '<';
    const orderColumn = orderColumns[query.sortBy];
    const pageWhere = decoded
      ? `${where} AND (${orderColumn} ${seekOperator} ? OR (${orderColumn} = ? AND t.id ${seekOperator} ?))`
      : where;
    const pageValues = decoded
      ? [...values, decoded.lastSortValue, decoded.lastSortValue, decoded.lastId]
      : values;
    const rows = this.sqlite
      .prepare(
        `SELECT
           t.id AS transactionId, t.date AS occurredOn, t.processed_date AS processedOn,
           t.description, t.charged_amount AS chargedAmount,
           t.charged_currency AS chargedCurrency, t.status AS transactionStatus,
           t.category AS categoryName, c.id AS categoryId, c.label AS categoryLabel,
           a.id AS accountId, a.display_name AS accountName, a.account_number AS accountNumber,
           a.account_type AS accountType, t.expense_owner_type AS ownerType,
           t.expense_owner_member_id AS ownerMemberId, m.name AS ownerName,
           t.needs_review AS needsReview,
           t.review_reason AS reviewReason, t.confidence, t.ignored
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         LEFT JOIN categories c ON c.name = t.category
         LEFT JOIN members m ON m.id = t.expense_owner_member_id
         ${pageWhere}
         ORDER BY ${orderColumn} ${direction}, t.id ${direction}
         LIMIT ?`,
      )
      .all(...pageValues, query.limit + 1) as TransactionRow[];
    const pageRows = rows.slice(0, query.limit);
    const hasMore = rows.length > query.limit;
    const lastRow = pageRows.at(-1);
    return {
      financialDate,
      transactions: pageRows.map((row) => this.project(row)),
      page: {
        total,
        hasMore,
        nextCursor:
          hasMore && lastRow
            ? this.cursors.encode({
                version: 2,
                lastSortValue: this.sortValue(query.sortBy, lastRow),
                lastId: lastRow.transactionId,
                snapshotCeilingId,
                snapshotDigest,
                fingerprint: queryFingerprint,
                financialDate,
              })
            : null,
      },
    };
  }

  detail(publicId: string, financialDate: string): TransactionResource | null {
    const localId = this.resolve('transaction', publicId, 'transactions');
    if (localId === null) return null;
    const row = this.sqlite
      .prepare(
        `SELECT
           t.id AS transactionId, t.date AS occurredOn, t.processed_date AS processedOn,
           t.description, t.charged_amount AS chargedAmount,
           t.charged_currency AS chargedCurrency, t.status AS transactionStatus,
           t.category AS categoryName, c.id AS categoryId, c.label AS categoryLabel,
           a.id AS accountId, a.display_name AS accountName, a.account_number AS accountNumber,
           a.account_type AS accountType, t.expense_owner_type AS ownerType,
           t.expense_owner_member_id AS ownerMemberId, m.name AS ownerName,
           t.needs_review AS needsReview,
           t.review_reason AS reviewReason, t.confidence, t.ignored
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         LEFT JOIN categories c ON c.name = t.category
         LEFT JOIN members m ON m.id = t.expense_owner_member_id
         WHERE t.id = ? AND t.date <= ?`,
      )
      .get(localId, financialDate) as TransactionRow | undefined;
    return row ? this.project(row) : null;
  }

  resolveTransactionId(publicId: string): number | null {
    return this.resolve('transaction', publicId, 'transactions');
  }

  private resolve(
    kind: 'transaction' | 'account' | 'member',
    publicId: string,
    table: string,
  ): number | null {
    const rows = this.sqlite.prepare(`SELECT id FROM ${table}`).all() as Array<{ id: number }>;
    return rows.find((row) => this.publicId(kind, row.id) === publicId)?.id ?? null;
  }

  private sortValue(sortBy: TransactionListQuery['sortBy'], row: TransactionRow): string | number {
    switch (sortBy) {
      case 'date':
        return row.occurredOn;
      case 'processedDate':
        return row.processedOn;
      case 'amount':
        return Math.abs(row.chargedAmount);
      case 'description':
        return row.description;
    }
  }

  private snapshotDigest(ceiling: number): string {
    const rows = this.sqlite
      .prepare(
        `SELECT
           t.id, t.account_id, t.date, t.processed_date, t.description,
           t.charged_amount, t.charged_currency, t.status, t.category,
           t.expense_owner_type, t.expense_owner_member_id, t.ignored,
           t.needs_review, t.review_reason, t.confidence,
           a.display_name AS account_name, a.account_number, a.account_type,
           c.id AS category_id, c.name AS category_name, c.label AS category_label,
           m.name AS owner_name
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         LEFT JOIN categories c ON c.name = t.category
         LEFT JOIN members m ON m.id = t.expense_owner_member_id
         WHERE t.id <= ?
         ORDER BY t.id`,
      )
      .all(ceiling);
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }

  private filters(query: TransactionListQuery, financialDate: string, ceiling: number) {
    const clauses = ['t.date <= ?', 't.id <= ?'];
    const values: Array<string | number> = [financialDate, ceiling];
    const add = (clause: string, value: string | number) => {
      clauses.push(clause);
      values.push(value);
    };
    if (query.startDate) add('t.date >= ?', query.startDate);
    if (query.endDate) add('t.date <= ?', query.endDate);
    if (!query.includeExcluded) clauses.push('t.ignored = 0');
    if (query.needsReview !== undefined) add('t.needs_review = ?', query.needsReview ? 1 : 0);
    if (query.direction === 'debit') clauses.push('t.charged_amount < 0');
    if (query.direction === 'credit') clauses.push('t.charged_amount > 0');
    if (query.direction === 'unknown') clauses.push('t.charged_amount = 0');
    if (query.status === 'posted') add('t.status = ?', 'completed');
    if (query.status === 'pending') add('t.status = ?', 'pending');
    if (query.status === 'unknown') clauses.push("t.status NOT IN ('completed', 'pending')");
    if (query.accountId) {
      const id = this.resolve('account', query.accountId, 'accounts');
      add('t.account_id = ?', id ?? -1);
    }
    if (query.accountType) add('a.account_type = ?', query.accountType);
    if (query.category) add('t.category = ?', query.category);
    if (query.ownerType) add('t.expense_owner_type = ?', query.ownerType);
    if (query.ownerMemberId) {
      const id = this.resolve('member', query.ownerMemberId, 'members');
      add('t.expense_owner_member_id = ?', id ?? -1);
    }
    if (query.minAmount !== undefined) add('ABS(t.charged_amount) >= ?', query.minAmount);
    if (query.maxAmount !== undefined) add('ABS(t.charged_amount) <= ?', query.maxAmount);
    if (query.q) {
      const literalQuery = query.q.replace(/[\\%_]/g, (character) => `\\${character}`);
      add("t.description LIKE ? ESCAPE '\\' COLLATE NOCASE", `%${literalQuery}%`);
    }
    return {
      where: `WHERE ${clauses.join(' AND ')}`,
      values,
    };
  }

  private project(row: TransactionRow): TransactionResource {
    const owner =
      row.ownerType === 'member' && row.ownerName
        ? {
            id: this.publicId('member', row.ownerMemberId!),
            kind: 'member' as const,
            displayName: boundedMobileText(row.ownerName, 'Member', 80),
          }
        : row.ownerType === 'shared'
          ? { id: null, kind: 'shared' as const, displayName: null }
          : row.ownerType === 'unassigned'
            ? { id: null, kind: 'unassigned' as const, displayName: null }
            : { id: null, kind: 'unknown' as const, displayName: null };
    return {
      id: this.publicId('transaction', row.transactionId),
      occurredOn: row.occurredOn,
      processedOn: row.processedOn || null,
      displayName: boundedMobileText(row.description, 'Transaction', 160),
      amount: projectMobileMoney(Math.abs(row.chargedAmount), row.chargedCurrency),
      direction: projectMobileTransactionDirection(row.chargedAmount),
      status: projectMobileTransactionStatus(row.transactionStatus),
      category:
        row.categoryName && row.categoryId !== null
          ? {
              id: this.publicId('category', row.categoryId),
              name: row.categoryName,
              label: boundedMobileText(row.categoryLabel ?? row.categoryName, 'Category', 80),
            }
          : null,
      account: {
        id: this.publicId('account', row.accountId),
        displayName: boundedMobileText(row.accountName, 'Account', 80),
        identifierMask: maskAccountIdentifier(row.accountNumber),
        type: row.accountType === 'credit_card' ? 'credit_card' : 'bank',
      },
      owner,
      needsReview: Boolean(row.needsReview),
      reviewReason: row.reviewReason
        ? boundedMobileText(row.reviewReason, 'Review needed', 240)
        : null,
      confidence: row.confidence,
      excludedFromReports: Boolean(row.ignored),
    };
  }
}
