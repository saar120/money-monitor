import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import { eq, sql } from 'drizzle-orm';
import * as schema from './schema.js';
import { ACCOUNT_TYPE_MAP } from '../shared/types.js';

export function runBackfills(db: BetterSQLite3Database<typeof schema>, sqlite: BetterSqlite3Database) {
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
  // Uses a dedicated flag table to track whether this backfill has already run.
  const backfillKey = 'backfill_manual_login_done';
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
}
