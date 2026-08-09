import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
import * as schema from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(__dirname, 'migrations');
const journalPath = join(migrationsFolder, 'meta', '_journal.json');

function applyMigrationFile(sqlite: Database.Database, tag: string) {
  const migrationSql = readFileSync(join(migrationsFolder, `${tag}.sql`), 'utf-8');
  for (const chunk of migrationSql.split('--> statement-breakpoint')) {
    const statement = chunk.trim();
    if (statement) sqlite.exec(statement);
  }
}

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
      expect(
        entries[i].when,
        `${entries[i].tag} must have timestamp > ${entries[i - 1].tag}`,
      ).toBeGreaterThan(entries[i - 1].when);
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
      expect(
        () => readFileSync(sqlPath, 'utf-8'),
        `Missing migration file: ${entry.tag}.sql`,
      ).not.toThrow();
    }
  });

  it('produces all expected tables after migration', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder });

    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name);

    const expectedTables = [
      'accounts',
      'account_balance_history',
      'asset_movements',
      'asset_snapshots',
      'assets',
      'canonical_mutation_receipts',
      'canonical_reference_resources',
      'canonical_seed_state',
      'categories',
      'holdings',
      'liabilities',
      'members',
      'mobile_devices',
      'ownership_rules',
      'scrape_logs',
      'transactions',
    ];

    for (const table of expectedTables) {
      expect(tableNames, `Missing table: ${table}`).toContain(table);
    }

    sqlite.close();
  });

  it('upgrades runtime-created canonical tables without colliding or losing receipts', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });

    // Establish the previous migration baseline, then reproduce the first
    // SAA-18 install path where the store created these two tables at runtime
    // before migration 0024 existed.
    migrate(db, { migrationsFolder });
    sqlite.exec('DROP TABLE canonical_seed_state');
    sqlite
      .prepare(
        'DELETE FROM __drizzle_migrations WHERE created_at = (SELECT MAX(created_at) FROM __drizzle_migrations)',
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO canonical_reference_resources
          (id, title, amount_value, currency_code, resource_version, updated_at)
         VALUES (1, 'Existing runtime resource', '10.00', 'ILS', 1, '2026-01-01T00:00:00.000Z')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO canonical_mutation_receipts
          (client_id, idempotency_key, request_fingerprint, outcome_json, created_at)
         VALUES ('mac-local', 'upgrade-receipt', '{}', '{"accepted":true,"resourceId":1,"refreshHints":[]}', '2026-01-01T00:00:00.000Z')`,
      )
      .run();

    expect(() => migrate(db, { migrationsFolder })).not.toThrow();
    expect(
      sqlite.prepare('SELECT title FROM canonical_reference_resources WHERE id = 1').get(),
    ).toEqual({
      title: 'Existing runtime resource',
    });
    expect(
      sqlite
        .prepare(
          'SELECT idempotency_key FROM canonical_mutation_receipts WHERE client_id = ? AND idempotency_key = ?',
        )
        .get('mac-local', 'upgrade-receipt'),
    ).toEqual({ idempotency_key: 'upgrade-receipt' });
    expect(sqlite.prepare('SELECT id, seeded_at FROM canonical_seed_state').get()).toEqual({
      id: 1,
      seeded_at: '1970-01-01T00:00:00.000Z',
    });
    sqlite.close();
  });

  it('schema columns match migration output (no drift)', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder });

    // Spot-check critical columns on key tables
    const accountCols = sqlite.prepare("PRAGMA table_info('accounts')").all() as Array<{
      name: string;
    }>;
    const accountColNames = accountCols.map((c) => c.name);
    expect(accountColNames).toContain('id');
    expect(accountColNames).toContain('company_id');
    expect(accountColNames).toContain('display_name');
    expect(accountColNames).toContain('member_id');
    expect(accountColNames).toContain('account_type');
    expect(accountColNames).toContain('balance');
    expect(accountColNames).toContain('is_active');

    const txCols = sqlite.prepare("PRAGMA table_info('transactions')").all() as Array<{
      name: string;
    }>;
    const txColNames = txCols.map((c) => c.name);
    expect(txColNames).toContain('id');
    expect(txColNames).toContain('account_id');
    expect(txColNames).toContain('date');
    expect(txColNames).toContain('charged_amount');
    expect(txColNames).toContain('description');
    expect(txColNames).toContain('category');
    expect(txColNames).toContain('charged_currency');
    expect(txColNames).toContain('expense_owner_type');
    expect(txColNames).toContain('expense_owner_member_id');
    expect(txColNames).toContain('owner_source');
    expect(txColNames).toContain('ignored');
    expect(txColNames).toContain('needs_review');
    expect(txColNames).toContain('hash');

    const liabCols = sqlite.prepare("PRAGMA table_info('liabilities')").all() as Array<{
      name: string;
    }>;
    const liabColNames = liabCols.map((c) => c.name);
    expect(liabColNames).toContain('id');
    expect(liabColNames).toContain('name');
    expect(liabColNames).toContain('currency');
    expect(liabColNames).toContain('current_balance');
    expect(liabColNames).toContain('is_active');

    const memberCols = sqlite.prepare("PRAGMA table_info('members')").all() as Array<{
      name: string;
    }>;
    const memberColNames = memberCols.map((c) => c.name);
    expect(memberColNames).toContain('id');
    expect(memberColNames).toContain('name');
    expect(memberColNames).toContain('is_active');

    const ruleCols = sqlite.prepare("PRAGMA table_info('ownership_rules')").all() as Array<{
      name: string;
    }>;
    const ruleColNames = ruleCols.map((c) => c.name);
    expect(ruleColNames).toContain('target_owner_type');
    expect(ruleColNames).toContain('description_contains');

    const mobileDeviceCols = sqlite.prepare("PRAGMA table_info('mobile_devices')").all() as Array<{
      name: string;
    }>;
    const mobileDeviceColNames = mobileDeviceCols.map((c) => c.name);
    expect(mobileDeviceColNames).toContain('id');
    expect(mobileDeviceColNames).toContain('token_digest');
    expect(mobileDeviceColNames).toContain('capabilities');
    expect(mobileDeviceColNames).toContain('revoked_at');

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
      sqlite
        .prepare(
          "INSERT INTO transactions (account_id, date, processed_date, original_amount, original_currency, charged_amount, description, hash) VALUES (99999, '2026-01-01', '2026-01-01', -100, 'ILS', -100, 'test', 'hash1')",
        )
        .run();
    }).toThrow();

    sqlite.close();
  });

  it('backfills existing transaction ownership from account members during household upgrade', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');

    const migrationTags = readdirSync(migrationsFolder)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => file.replace(/\.sql$/, ''))
      .sort();

    for (const tag of migrationTags.filter((tag) => tag < '0020_household_ownership')) {
      applyMigrationFile(sqlite, tag);
    }

    sqlite
      .prepare(
        "INSERT INTO accounts (company_id, display_name, credentials_ref) VALUES ('hapoalim', 'Main', 'cred-1')",
      )
      .run();
    const accountId = sqlite.prepare('SELECT id FROM accounts').get() as { id: number };
    sqlite
      .prepare(
        "INSERT INTO transactions (account_id, date, processed_date, original_amount, original_currency, charged_amount, description, hash) VALUES (?, '2026-01-01', '2026-01-01', -100, 'ILS', -100, 'test', 'hash1')",
      )
      .run(accountId.id);

    applyMigrationFile(sqlite, '0020_household_ownership');

    const tx = sqlite
      .prepare(
        'SELECT expense_owner_type, expense_owner_member_id, owner_source, owner_confidence FROM transactions',
      )
      .get() as {
      expense_owner_type: string;
      expense_owner_member_id: number | null;
      owner_source: string;
      owner_confidence: number | null;
    };

    expect(tx).toEqual({
      expense_owner_type: 'member',
      expense_owner_member_id: 1,
      owner_source: 'account',
      owner_confidence: 1,
    });

    sqlite.close();
  });
});
