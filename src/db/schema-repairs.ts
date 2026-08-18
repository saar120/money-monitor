import type Database from 'better-sqlite3';

/**
 * Ensure the source-identity table exists even when a database's migration
 * journal was written by a newer branch.
 *
 * Drizzle's SQLite migrator intentionally skips every migration whose journal
 * timestamp is older than the latest timestamp already in the database. A
 * database can therefore be missing a table introduced by this build when the
 * histories came from different branches. Keep this repair idempotent and
 * limited to the table required by the One Zero import path; normal fresh
 * databases still create it through migration 0021.
 */
export function ensureTransactionSourcesSchema(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS transaction_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON UPDATE no action ON DELETE cascade,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON UPDATE no action ON DELETE cascade,
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')) NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_transaction_sources_account_source_external
      ON transaction_sources(account_id, source, external_id);
    CREATE INDEX IF NOT EXISTS idx_transaction_sources_transaction
      ON transaction_sources(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_transaction_sources_account
      ON transaction_sources(account_id);
  `);
}
