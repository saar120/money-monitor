import Database, { type Database as BetterSqlite3Database } from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { dbPath, demoDbPath } from '../paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(__dirname, 'migrations');

// Validate that all migration file chunks (split by --> statement-breakpoint) contain
// only one top-level statement. Without breakpoints, better-sqlite3's prepare() throws
// "contains more than one statement". This catches hand-written migrations early.
const sqlFiles = readdirSync(migrationsFolder).filter(f => f.endsWith('.sql'));
for (const file of sqlFiles) {
	const sql = readFileSync(join(migrationsFolder, file), 'utf-8');
	const chunks = sql.split('--> statement-breakpoint');
	for (const chunk of chunks) {
		// Strip compound blocks (trigger/view bodies between BEGIN...END) so we only
		// count top-level statements — inner statements inside triggers are fine.
		const stripped = chunk.replace(/BEGIN[\s\S]*?END;/gi, 'COMPOUND_BLOCK;');
		const lines = stripped.split('\n').filter(l => !l.startsWith('--') && l.trim());
		const stmtStarts = lines.filter(l => /^\s*(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|PRAGMA)\b/i.test(l));
		if (stmtStarts.length > 1) {
			throw new Error(
				`Migration "${file}" has a chunk with ${stmtStarts.length} top-level statements but no "--> statement-breakpoint" between them. ` +
				`Add "--> statement-breakpoint" between each SQL statement.`
			);
		}
	}
}

// --- Real database (always initialized) ---

const realSqlite: BetterSqlite3Database = new Database(dbPath);
realSqlite.pragma('journal_mode = WAL');
realSqlite.pragma('foreign_keys = ON');

const realDb = drizzle(realSqlite, { schema });

migrate(realDb, { migrationsFolder });

import { runBackfills } from './backfills.js';
runBackfills(realDb, realSqlite);

// --- Mutable exports (live bindings allow runtime swap) ---

export let db: BetterSQLite3Database<typeof schema> = realDb;
export let sqlite: BetterSqlite3Database = realSqlite;

// --- Demo mode swap ---

let _isDemoMode = false;
let demoSqlite: BetterSqlite3Database | null = null;
let demoDb: BetterSQLite3Database<typeof schema> | null = null;

export function isDemoMode(): boolean {
  return _isDemoMode;
}

export function swapToDemo(): { db: BetterSQLite3Database<typeof schema>; sqlite: BetterSqlite3Database } {
  if (_isDemoMode) return { db: demoDb!, sqlite: demoSqlite! };

  // Create/open the demo database
  demoSqlite = new Database(demoDbPath);
  demoSqlite.pragma('journal_mode = WAL');
  demoSqlite.pragma('foreign_keys = ON');
  demoDb = drizzle(demoSqlite, { schema });

  // Run migrations + backfills on the demo db
  migrate(demoDb, { migrationsFolder });
  runBackfills(demoDb, demoSqlite);

  // Swap the live exports
  db = demoDb;
  sqlite = demoSqlite;
  _isDemoMode = true;

  return { db: demoDb, sqlite: demoSqlite };
}

export function swapToReal(): void {
  if (!_isDemoMode) return;

  // Close demo connection
  if (demoSqlite) {
    demoSqlite.close();
    demoSqlite = null;
    demoDb = null;
  }

  // Restore real exports
  db = realDb;
  sqlite = realSqlite;
  _isDemoMode = false;
}

export function closeAll(): void {
  if (demoSqlite) {
    demoSqlite.close();
    demoSqlite = null;
    demoDb = null;
  }
  realSqlite.close();
}
