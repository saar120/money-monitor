import Database, { type Database as BetterSqlite3Database } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { dbPath } from '../paths.js';

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

const sqlite: BetterSqlite3Database = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export { sqlite };

// Auto-run pending migrations on startup — each environment (worktree, prod)
// manages its own local database, so this never touches a shared db.
migrate(db, { migrationsFolder });

// Run data backfills after migrations
import { runBackfills } from './backfills.js';
runBackfills(db, sqlite);
