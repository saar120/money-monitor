import Database, { type Database as BetterSqlite3Database } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';
import { eq, sql } from 'drizzle-orm';
import { ACCOUNT_TYPE_MAP } from '../shared/types.js';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

mkdirSync(join(PROJECT_ROOT, 'data'), { recursive: true });

const sqlite: BetterSqlite3Database = new Database(join(PROJECT_ROOT, 'data', 'money-monitor.db'));
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export { sqlite };

// Auto-run pending migrations on startup — each environment (worktree, prod)
// manages its own local database, so this never touches a shared db.
migrate(db, { migrationsFolder: join(__dirname, 'migrations') });

// Backfill accountType for existing accounts (only if any rows need it)
const needsBackfill = db.select({ id: schema.accounts.id })
  .from(schema.accounts)
  .where(sql`${schema.accounts.accountType} = 'bank' AND ${schema.accounts.companyId} IN ('isracard','amex','max','visaCal','beyahadBishvilha','behatsdaa','pagi')`)
  .all();

if (needsBackfill.length > 0) {
  for (const [companyId, accountType] of Object.entries(ACCOUNT_TYPE_MAP)) {
    db.update(schema.accounts)
      .set({ accountType })
      .where(eq(schema.accounts.companyId, companyId))
      .run();
  }
}

// One-time backfill: set manualLogin for Isracard/Amex accounts after migration 0004.
// Uses a pragma to track whether this backfill has already run.
const backfillKey = 'backfill_manual_login_done';
const backfillDone = sqlite.pragma(`user_version`) as number;
// We use a dedicated flag table instead of user_version (which may be used by drizzle)
sqlite.exec(`CREATE TABLE IF NOT EXISTS _backfill_flags (key TEXT PRIMARY KEY, done INTEGER NOT NULL DEFAULT 1)`);
const flag = db.all(sql`SELECT 1 FROM _backfill_flags WHERE key = ${backfillKey}`);
if (flag.length === 0) {
  const MANUAL_LOGIN_COMPANY_IDS = ['isracard', 'amex'];
  for (const companyId of MANUAL_LOGIN_COMPANY_IDS) {
    db.update(schema.accounts)
      .set({ manualLogin: true, showBrowser: true })
      .where(sql`${schema.accounts.companyId} = ${companyId} AND ${schema.accounts.manualLogin} = 0`)
      .run();
  }
  sqlite.exec(`INSERT OR IGNORE INTO _backfill_flags (key) VALUES ('${backfillKey}')`);
}
