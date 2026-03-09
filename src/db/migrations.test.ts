import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import * as schema from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(__dirname, 'migrations');
const journalPath = join(migrationsFolder, 'meta', '_journal.json');

describe('database migrations', () => {
  it('all migrations apply cleanly on a fresh database', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });

    expect(() => migrate(db, { migrationsFolder })).not.toThrow();
    sqlite.close();
  });

  it('migrations are idempotent (running twice does not error)', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });

    migrate(db, { migrationsFolder });
    expect(() => migrate(db, { migrationsFolder })).not.toThrow();
    sqlite.close();
  });

  it('journal entries have strictly increasing timestamps', () => {
    const journal = JSON.parse(readFileSync(journalPath, 'utf-8'));
    const entries: Array<{ idx: number; when: number; tag: string }> = journal.entries;

    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].when, `${entries[i].tag} must have timestamp > ${entries[i - 1].tag}`)
        .toBeGreaterThan(entries[i - 1].when);
    }
  });

  it('journal idx values are sequential starting from 0', () => {
    const journal = JSON.parse(readFileSync(journalPath, 'utf-8'));
    const entries: Array<{ idx: number }> = journal.entries;

    entries.forEach((entry, i) => {
      expect(entry.idx).toBe(i);
    });
  });

  it('every journal entry has a matching .sql file', () => {
    const journal = JSON.parse(readFileSync(journalPath, 'utf-8'));
    const entries: Array<{ tag: string }> = journal.entries;

    for (const entry of entries) {
      const sqlPath = join(migrationsFolder, `${entry.tag}.sql`);
      expect(() => readFileSync(sqlPath, 'utf-8'), `Missing migration file: ${entry.tag}.sql`).not.toThrow();
    }
  });

  it('produces all expected tables after migration', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder });

    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name")
      .all() as Array<{ name: string }>;

    const tableNames = tables.map(t => t.name);

    const expectedTables = [
      'accounts',
      'account_balance_history',
      'asset_movements',
      'asset_snapshots',
      'assets',
      'categories',
      'holdings',
      'liabilities',
      'scrape_logs',
      'transactions',
    ];

    for (const table of expectedTables) {
      expect(tableNames, `Missing table: ${table}`).toContain(table);
    }

    sqlite.close();
  });

  it('schema columns match migration output (no drift)', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder });

    // Spot-check critical columns on key tables
    const accountCols = sqlite.prepare("PRAGMA table_info('accounts')").all() as Array<{ name: string }>;
    const accountColNames = accountCols.map(c => c.name);
    expect(accountColNames).toContain('id');
    expect(accountColNames).toContain('company_id');
    expect(accountColNames).toContain('display_name');
    expect(accountColNames).toContain('account_type');
    expect(accountColNames).toContain('balance');
    expect(accountColNames).toContain('is_active');

    const txCols = sqlite.prepare("PRAGMA table_info('transactions')").all() as Array<{ name: string }>;
    const txColNames = txCols.map(c => c.name);
    expect(txColNames).toContain('id');
    expect(txColNames).toContain('account_id');
    expect(txColNames).toContain('date');
    expect(txColNames).toContain('charged_amount');
    expect(txColNames).toContain('description');
    expect(txColNames).toContain('category');
    expect(txColNames).toContain('ignored');
    expect(txColNames).toContain('needs_review');
    expect(txColNames).toContain('hash');

    const liabCols = sqlite.prepare("PRAGMA table_info('liabilities')").all() as Array<{ name: string }>;
    const liabColNames = liabCols.map(c => c.name);
    expect(liabColNames).toContain('id');
    expect(liabColNames).toContain('name');
    expect(liabColNames).toContain('currency');
    expect(liabColNames).toContain('current_balance');
    expect(liabColNames).toContain('is_active');

    sqlite.close();
  });

  it('FTS5 virtual table can be created after migrations', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder });

    expect(() => {
      sqlite.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS transactions_fts
        USING fts5(description, memo, content='transactions', content_rowid='id');
      `);
    }).not.toThrow();

    expect(() => {
      sqlite.exec(`
        CREATE TRIGGER IF NOT EXISTS transactions_ai AFTER INSERT ON transactions BEGIN
          INSERT INTO transactions_fts(rowid, description, memo) VALUES (new.id, new.description, new.memo);
        END;
      `);
    }).not.toThrow();

    sqlite.close();
  });

  it('foreign keys are enforced after migration', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder });

    expect(() => {
      sqlite.prepare(
        "INSERT INTO transactions (account_id, date, processed_date, original_amount, original_currency, charged_amount, description, hash) VALUES (99999, '2026-01-01', '2026-01-01', -100, 'ILS', -100, 'test', 'hash1')"
      ).run();
    }).toThrow();

    sqlite.close();
  });
});
