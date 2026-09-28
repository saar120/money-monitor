import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it, vi } from 'vitest';
import * as schema from './schema.js';
import { seedDemoData } from './demo-seed.js';

it('refreshes old demo data when demo mode is enabled', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'money-monitor-demo-'));
  const demoDbPath = join(directory, 'demo.db');
  const fixtureSqlite = new Database(demoDbPath);
  const fixtureDb = drizzle(fixtureSqlite, { schema });
  migrate(fixtureDb, { migrationsFolder: fileURLToPath(new URL('./migrations', import.meta.url)) });

  const oldDate = new Date();
  oldDate.setMonth(oldDate.getMonth() - 7);
  vi.useFakeTimers();
  vi.setSystemTime(oldDate);
  seedDemoData(fixtureDb, fixtureSqlite);
  vi.useRealTimers();
  fixtureSqlite.close();

  vi.doMock('../paths.js', () => ({
    dataDir: directory,
    dbPath: join(directory, 'money-monitor.db'),
    demoDbPath,
    credentialsPath: join(directory, 'credentials.enc'),
    configPath: join(directory, 'config.json'),
    chatDir: join(directory, 'chat'),
    sessionsDir: join(directory, 'chat', 'sessions'),
    usesElectronUserData: false,
  }));
  vi.resetModules();
  let connection: typeof import('./connection.js') | undefined;
  try {
    connection = await import('./connection.js');
    connection.swapToDemo();
    seedDemoData(connection.db, connection.sqlite);
    const month = new Date()
      .toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })
      .slice(0, 7);
    const currentCount = connection.sqlite
      .prepare('SELECT count(*) AS count FROM transactions WHERE substr(date, 1, 7) = ?')
      .get(month) as { count: number };
    expect(currentCount.count).toBeGreaterThan(0);
    const budgetCount = connection.sqlite
      .prepare('SELECT count(*) AS count FROM budgets')
      .get() as {
      count: number;
    };
    const reviewCount = connection.sqlite
      .prepare('SELECT count(*) AS count FROM transactions WHERE needs_review = 1')
      .get() as { count: number };
    const { readRecurringPayments } = await import('../services/recurring-payments.js');
    const recurring = await readRecurringPayments(
      connection.db,
      new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }),
    );
    expect(budgetCount.count).toBeGreaterThan(0);
    expect(reviewCount.count).toBeGreaterThan(0);
    expect(recurring.payments.length).toBeGreaterThan(0);
  } finally {
    connection?.closeAll();
    vi.doUnmock('../paths.js');
    vi.resetModules();
    vi.useRealTimers();
    rmSync(directory, { recursive: true, force: true });
  }
});
