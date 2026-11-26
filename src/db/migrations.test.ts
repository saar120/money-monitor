import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
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

function openMigratedDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return { sqlite, db };
}

describe('database migrations', () => {
  it('applies cleanly and idempotently on a fresh database', () => {
    const { sqlite, db } = openMigratedDb();
    try {
      expect(() => migrate(db, { migrationsFolder })).not.toThrow();
    } finally {
      sqlite.close();
    }
  });

  it('maintains a valid sequential migration journal with matching SQL files', () => {
    const journal = JSON.parse(readFileSync(journalPath, 'utf-8'));
    const entries: Array<{ idx: number; when: number; tag: string }> = journal.entries;

    entries.forEach((entry, i) => {
      expect(entry.idx).toBe(i);
      if (i > 0) {
        expect(
          entry.when,
          `${entry.tag} must have timestamp > ${entries[i - 1].tag}`,
        ).toBeGreaterThan(entries[i - 1].when);
      }
      expect(
        () => readFileSync(join(migrationsFolder, `${entry.tag}.sql`), 'utf-8'),
        `Missing migration file: ${entry.tag}.sql`,
      ).not.toThrow();
    });
  });

  it('derives reporting_date from effective_date or falls back to bank date', () => {
    const { sqlite, db } = openMigratedDb();
    try {
      const account = db
        .insert(schema.accounts)
        .values({ companyId: 'hapoalim', displayName: 'Main', credentialsRef: 'cred-1' })
        .returning()
        .get();

      const standard = db
        .insert(schema.transactions)
        .values({
          accountId: account.id,
          date: '2026-09-01',
          processedDate: '2026-09-01',
          originalAmount: -100,
          originalCurrency: 'ILS',
          chargedAmount: -100,
          description: 'Standard',
          hash: 'h-standard',
        })
        .returning()
        .get();
      const overridden = db
        .insert(schema.transactions)
        .values({
          accountId: account.id,
          date: '2026-09-01',
          effectiveDate: '2026-08-31',
          processedDate: '2026-09-01',
          originalAmount: -200,
          originalCurrency: 'ILS',
          chargedAmount: -200,
          description: 'Overridden',
          hash: 'h-overridden',
        })
        .returning()
        .get();

      expect(standard.reportingDate).toBe('2026-09-01');
      expect(overridden.reportingDate).toBe('2026-08-31');
    } finally {
      sqlite.close();
    }
  });

  it('enforces load-bearing unique indexes across financial and mobile tables', () => {
    const { sqlite, db } = openMigratedDb();
    try {
      const account = db
        .insert(schema.accounts)
        .values({ companyId: 'hapoalim', displayName: 'Main', credentialsRef: 'cred-1' })
        .returning()
        .get();
      const assetA = db
        .insert(schema.assets)
        .values({ name: 'Broker A', type: 'brokerage', currency: 'ILS' })
        .returning()
        .get();
      const assetB = db
        .insert(schema.assets)
        .values({ name: 'Broker B', type: 'brokerage', currency: 'ILS' })
        .returning()
        .get();

      expect(() =>
        db
          .insert(schema.assets)
          .values({ name: 'Broker A', type: 'brokerage', currency: 'ILS' })
          .run(),
      ).toThrow();

      const txBase = {
        accountId: account.id,
        date: '2026-01-01',
        processedDate: '2026-01-01',
        originalAmount: -10,
        originalCurrency: 'ILS',
        chargedAmount: -10,
        description: 'Coffee',
        hash: 'dup-hash',
      };
      db.insert(schema.transactions).values(txBase).run();
      expect(() => db.insert(schema.transactions).values(txBase).run()).toThrow();

      const holdingBase = { name: 'VOO', type: 'etf', currency: 'USD', quantity: 1 };
      db.insert(schema.holdings)
        .values({ ...holdingBase, assetId: assetA.id })
        .run();
      expect(() =>
        db
          .insert(schema.holdings)
          .values({ ...holdingBase, assetId: assetA.id })
          .run(),
      ).toThrow();
      expect(() =>
        db
          .insert(schema.holdings)
          .values({ ...holdingBase, assetId: assetB.id })
          .run(),
      ).not.toThrow();

      db.insert(schema.mobileDevices)
        .values({ id: 'dev-1', name: 'Phone 1', tokenDigest: 'digest-1' })
        .run();
      expect(() =>
        db
          .insert(schema.mobileDevices)
          .values({ id: 'dev-2', name: 'Phone 2', tokenDigest: 'digest-1' })
          .run(),
      ).toThrow();

      db.insert(schema.assetSnapshots)
        .values({ assetId: assetA.id, date: '2026-01-01', totalValueIls: 100 })
        .run();
      expect(() =>
        db
          .insert(schema.assetSnapshots)
          .values({ assetId: assetA.id, date: '2026-01-01', totalValueIls: 200 })
          .run(),
      ).toThrow();

      db.insert(schema.accountBalanceHistory)
        .values({ accountId: account.id, date: '2026-01-01', balance: 500 })
        .run();
      expect(() =>
        db
          .insert(schema.accountBalanceHistory)
          .values({ accountId: account.id, date: '2026-01-01', balance: 600 })
          .run(),
      ).toThrow();
    } finally {
      sqlite.close();
    }
  });

  it('enforces asset cascade deletes and account unlink set-null rules', () => {
    const { sqlite, db } = openMigratedDb();
    try {
      const account = db
        .insert(schema.accounts)
        .values({ companyId: 'hapoalim', displayName: 'Main', credentialsRef: 'cred-1' })
        .returning()
        .get();
      const asset = db
        .insert(schema.assets)
        .values({
          name: 'Linked Broker',
          type: 'brokerage',
          currency: 'ILS',
          linkedAccountId: account.id,
        })
        .returning()
        .get();
      db.insert(schema.holdings)
        .values({ assetId: asset.id, name: 'VOO', type: 'etf', currency: 'USD', quantity: 2 })
        .run();
      db.insert(schema.assetSnapshots)
        .values({ assetId: asset.id, date: '2026-01-01', totalValueIls: 1000 })
        .run();
      db.insert(schema.assetMovements)
        .values({
          assetId: asset.id,
          date: '2026-01-01',
          type: 'deposit',
          quantity: 1000,
          currency: 'ILS',
        })
        .run();

      db.delete(schema.accounts).where(eq(schema.accounts.id, account.id)).run();
      const unlinked = db.select().from(schema.assets).where(eq(schema.assets.id, asset.id)).get();
      expect(unlinked?.linkedAccountId).toBeNull();

      db.delete(schema.assets).where(eq(schema.assets.id, asset.id)).run();
      expect(db.select().from(schema.holdings).all()).toHaveLength(0);
      expect(db.select().from(schema.assetSnapshots).all()).toHaveLength(0);
      expect(db.select().from(schema.assetMovements).all()).toHaveLength(0);
    } finally {
      sqlite.close();
    }
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
  it('preserves legacy inclusion intent and versions later business writes', () => {
    const sqlite = new Database(':memory:');
    try {
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        entries: Array<{ tag: string }>;
      };
      for (const { tag } of journal.entries) {
        if (tag === '0025_financial_commands') break;
        applyMigrationFile(sqlite, tag);
      }
      sqlite.exec(
        "INSERT INTO accounts(company_id, display_name, credentials_ref) VALUES ('oneZero', 'Synthetic bank', 'synthetic');",
      );
      sqlite.exec(
        "INSERT INTO transactions(account_id, date, processed_date, original_amount, charged_amount, description, hash, ignored) VALUES (1, '2026-01-01', '2026-01-01', -1, -1, 'Synthetic', 'synthetic', 1);",
      );
      applyMigrationFile(sqlite, '0025_financial_commands');
      expect(
        sqlite
          .prepare('SELECT ignored, inclusion_source, resource_version FROM transactions')
          .get(),
      ).toEqual({ ignored: 1, inclusion_source: 'legacy', resource_version: 1 });
      sqlite.exec("UPDATE transactions SET category = 'food';");
      expect(
        sqlite
          .prepare('SELECT ignored, inclusion_source, resource_version FROM transactions')
          .get(),
      ).toEqual({ ignored: 1, inclusion_source: 'legacy', resource_version: 2 });
    } finally {
      sqlite.close();
    }
  });
});
