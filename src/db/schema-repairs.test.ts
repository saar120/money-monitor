import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';
import { ensureTransactionSourcesSchema } from './schema-repairs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(__dirname, 'migrations');

describe('schema compatibility repairs', () => {
  it('restores transaction_sources when migration history is ahead of this build', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });

    migrate(db, { migrationsFolder });
    sqlite.exec('DROP TABLE transaction_sources');
    sqlite.exec(
      'DELETE FROM __drizzle_migrations WHERE created_at = (SELECT MAX(created_at) FROM __drizzle_migrations)',
    );
    sqlite
      .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
      .run('future-branch-marker', 9_999_999_999_999);

    // Drizzle intentionally skips this checkout's migrations because the DB
    // marker is newer. The startup compatibility seam must still restore the
    // table required by the import route.
    migrate(db, { migrationsFolder });
    expect(
      sqlite
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'transaction_sources'",
        )
        .get(),
    ).toBeUndefined();

    ensureTransactionSourcesSchema(sqlite);

    expect(
      sqlite
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'transaction_sources'",
        )
        .get(),
    ).toEqual({ 1: 1 });
    expect(
      sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_transaction_sources_account_source_external'",
        )
        .get(),
    ).toEqual({ name: 'idx_transaction_sources_account_source_external' });

    sqlite.close();
  });
});
