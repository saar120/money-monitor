import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type {
  Transaction,
  TransactionFilters,
  TransactionSummary,
  TransactionType,
  TransactionStatus,
} from '../../types/index.js';

interface RawTransaction {
  id: string;
  account_id: string;
  provider_account_number: string;
  type: TransactionType;
  date: string;
  processed_date: string;
  original_amount: number;
  original_currency: string;
  charged_amount: number;
  description: string;
  memo: string | null;
  category: string | null;
  installment_number: number | null;
  installment_total: number | null;
  status: TransactionStatus;
  identifier: number | null;
  scraped_at: string;
}

function rowToTransaction(row: RawTransaction): Transaction {
  return {
    id: row.id,
    accountId: row.account_id,
    providerAccountNumber: row.provider_account_number,
    type: row.type,
    date: row.date,
    processedDate: row.processed_date,
    originalAmount: row.original_amount,
    originalCurrency: row.original_currency,
    chargedAmount: row.charged_amount,
    description: row.description,
    memo: row.memo,
    category: row.category,
    installmentNumber: row.installment_number,
    installmentTotal: row.installment_total,
    status: row.status,
    identifier: row.identifier,
    scrapedAt: row.scraped_at,
  };
}

export class TransactionRepository {
  constructor(private db: Database.Database) {}

  /**
   * Upsert a batch of transactions from a scrape. Uses INSERT OR IGNORE
   * so duplicate transactions (same account + date + amount + description)
   * are silently skipped.
   */
  upsertBatch(
    accountId: string,
    providerAccountNumber: string,
    transactions: Array<{
      type: TransactionType;
      date: string;
      processedDate: string;
      originalAmount: number;
      originalCurrency: string;
      chargedAmount: number;
      description: string;
      memo: string | null;
      installmentNumber: number | null;
      installmentTotal: number | null;
      status: TransactionStatus;
      identifier: number | null;
    }>,
  ): number {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO transactions (
        id, account_id, provider_account_number, type, date, processed_date,
        original_amount, original_currency, charged_amount, description,
        memo, installment_number, installment_total, status, identifier, scraped_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, datetime('now')
      )
    `);

    let inserted = 0;
    const insertAll = this.db.transaction(() => {
      for (const txn of transactions) {
        const result = stmt.run(
          uuidv4(),
          accountId,
          providerAccountNumber,
          txn.type,
          txn.date,
          txn.processedDate,
          txn.originalAmount,
          txn.originalCurrency,
          txn.chargedAmount,
          txn.description,
          txn.memo,
          txn.installmentNumber,
          txn.installmentTotal,
          txn.status,
          txn.identifier,
        );
        if (result.changes > 0) inserted++;
      }
    });

    insertAll();
    return inserted;
  }

  findAll(filters: TransactionFilters = {}): Transaction[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.accountId) {
      conditions.push('account_id = ?');
      params.push(filters.accountId);
    }
    if (filters.startDate) {
      conditions.push('date >= ?');
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      conditions.push('date <= ?');
      params.push(filters.endDate);
    }
    if (filters.category) {
      conditions.push('category = ?');
      params.push(filters.category);
    }
    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (filters.minAmount !== undefined) {
      conditions.push('charged_amount >= ?');
      params.push(filters.minAmount);
    }
    if (filters.maxAmount !== undefined) {
      conditions.push('charged_amount <= ?');
      params.push(filters.maxAmount);
    }
    if (filters.description) {
      conditions.push('description LIKE ?');
      params.push(`%${filters.description}%`);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit ?? 500;
    const offset = filters.offset ?? 0;

    const rows = this.db
      .prepare(
        `SELECT * FROM transactions ${where} ORDER BY date DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as RawTransaction[];

    return rows.map(rowToTransaction);
  }

  getSummary(filters: TransactionFilters = {}): TransactionSummary {
    const transactions = this.findAll({ ...filters, limit: 100_000, offset: 0 });

    const summary: TransactionSummary = {
      totalIncome: 0,
      totalExpenses: 0,
      netAmount: 0,
      transactionCount: transactions.length,
      byCategory: {},
      byCurrency: {},
      byMonth: {},
    };

    for (const txn of transactions) {
      const amount = txn.chargedAmount;

      if (amount > 0) {
        summary.totalIncome += amount;
      } else {
        summary.totalExpenses += Math.abs(amount);
      }

      // By category
      const cat = txn.category ?? 'uncategorized';
      summary.byCategory[cat] = (summary.byCategory[cat] ?? 0) + amount;

      // By currency
      summary.byCurrency[txn.originalCurrency] =
        (summary.byCurrency[txn.originalCurrency] ?? 0) + txn.originalAmount;

      // By month
      const month = txn.date.slice(0, 7); // YYYY-MM
      if (!summary.byMonth[month]) {
        summary.byMonth[month] = { income: 0, expenses: 0 };
      }
      if (amount > 0) {
        summary.byMonth[month].income += amount;
      } else {
        summary.byMonth[month].expenses += Math.abs(amount);
      }
    }

    summary.netAmount = summary.totalIncome - summary.totalExpenses;
    return summary;
  }

  getCategories(): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT category FROM transactions
         WHERE category IS NOT NULL ORDER BY category`,
      )
      .all() as Array<{ category: string }>;

    return rows.map((r) => r.category);
  }

  updateCategory(transactionId: string, category: string): boolean {
    const result = this.db
      .prepare('UPDATE transactions SET category = ? WHERE id = ?')
      .run(category, transactionId);
    return result.changes > 0;
  }

  bulkUpdateCategory(
    filter: { description: string },
    category: string,
  ): number {
    const result = this.db
      .prepare(
        `UPDATE transactions SET category = ? WHERE description LIKE ?`,
      )
      .run(category, `%${filter.description}%`);
    return result.changes;
  }

  getTopExpenses(
    startDate: string,
    endDate: string,
    limit: number = 20,
  ): Transaction[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM transactions
         WHERE date >= ? AND date <= ? AND charged_amount < 0
         ORDER BY charged_amount ASC
         LIMIT ?`,
      )
      .all(startDate, endDate, limit) as RawTransaction[];

    return rows.map(rowToTransaction);
  }

  getMonthlyTotals(): Array<{ month: string; income: number; expenses: number }> {
    const rows = this.db
      .prepare(
        `SELECT
           substr(date, 1, 7) as month,
           SUM(CASE WHEN charged_amount > 0 THEN charged_amount ELSE 0 END) as income,
           SUM(CASE WHEN charged_amount < 0 THEN ABS(charged_amount) ELSE 0 END) as expenses
         FROM transactions
         GROUP BY month
         ORDER BY month DESC`,
      )
      .all() as Array<{ month: string; income: number; expenses: number }>;

    return rows;
  }
}
