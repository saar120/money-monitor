import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../db/schema.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(__dirname, '..', '..', 'db', 'migrations');

export interface TestDb {
  db: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
  close: () => void;
}

export function createTestDb(): TestDb {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });

  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS transactions_fts
    USING fts5(description, memo, content='transactions', content_rowid='id');
  `);
  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS transactions_ai AFTER INSERT ON transactions BEGIN
      INSERT INTO transactions_fts(rowid, description, memo) VALUES (new.id, new.description, new.memo);
    END;
  `);
  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS transactions_ad AFTER DELETE ON transactions BEGIN
      INSERT INTO transactions_fts(transactions_fts, rowid, description, memo) VALUES('delete', old.id, old.description, old.memo);
    END;
  `);
  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS transactions_au AFTER UPDATE ON transactions BEGIN
      INSERT INTO transactions_fts(transactions_fts, rowid, description, memo) VALUES('delete', old.id, old.description, old.memo);
      INSERT INTO transactions_fts(rowid, description, memo) VALUES (new.id, new.description, new.memo);
    END;
  `);

  return { db, sqlite, close: () => sqlite.close() };
}
