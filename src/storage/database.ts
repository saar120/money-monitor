import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

let db: Database.Database | null = null;

export function getDatabase(dbPath: string): Database.Database {
  if (db) return db;

  // Ensure the directory exists
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  db = new Database(dbPath);

  // Performance pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  runMigrations(db);

  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `);

  const currentVersion =
    db.prepare('SELECT MAX(version) as v FROM schema_version').get() as
      | { v: number | null }
      | undefined;
  const version = currentVersion?.v ?? 0;

  const migrations: Array<{ version: number; sql: string }> = [
    {
      version: 1,
      sql: `
        CREATE TABLE accounts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          provider TEXT NOT NULL,
          encrypted_credentials TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_scraped_at TEXT
        );

        CREATE TABLE transactions (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          provider_account_number TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'normal',
          date TEXT NOT NULL,
          processed_date TEXT NOT NULL,
          original_amount REAL NOT NULL,
          original_currency TEXT NOT NULL DEFAULT 'ILS',
          charged_amount REAL NOT NULL,
          description TEXT NOT NULL,
          memo TEXT,
          category TEXT,
          installment_number INTEGER,
          installment_total INTEGER,
          status TEXT NOT NULL DEFAULT 'completed',
          identifier INTEGER,
          scraped_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_transactions_account_id ON transactions(account_id);
        CREATE INDEX idx_transactions_date ON transactions(date);
        CREATE INDEX idx_transactions_category ON transactions(category);
        CREATE INDEX idx_transactions_description ON transactions(description);

        -- Prevent duplicate transactions from repeated scrapes
        CREATE UNIQUE INDEX idx_transactions_unique ON transactions(
          account_id,
          provider_account_number,
          date,
          charged_amount,
          description,
          identifier
        );
      `,
    },
    {
      version: 2,
      sql: `
        CREATE TABLE scrape_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          success INTEGER NOT NULL,
          accounts_found INTEGER NOT NULL DEFAULT 0,
          transactions_found INTEGER NOT NULL DEFAULT 0,
          error_type TEXT,
          error_message TEXT,
          scraped_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_scrape_logs_account_id ON scrape_logs(account_id);
      `,
    },
  ];

  const toRun = migrations.filter((m) => m.version > version);
  if (toRun.length === 0) return;

  const runAll = db.transaction(() => {
    for (const migration of toRun) {
      db!.exec(migration.sql);
      db!.prepare('INSERT INTO schema_version (version) VALUES (?)').run(
        migration.version,
      );
    }
  });

  runAll();
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
