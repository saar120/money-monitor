import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { createMobilePublicIdProjector } from './mobile-public-id.js';
import { boundedMobileText, maskAccountIdentifier, projectMobileMoney } from './mobile-transaction-projection.js';
import type { MobilePlanningSnapshot } from './planning-contract.js';

type MoneyMonitorDatabase = BetterSQLite3Database<typeof schema>;

export interface ProductionMobilePlanningPortOptions { db: MoneyMonitorDatabase; publicIdKey: string; }

const INSTITUTIONS: Readonly<Record<string, string>> = {
  hapoalim: 'Bank Hapoalim', leumi: 'Bank Leumi', discount: 'Israel Discount Bank', mizrahi: 'Mizrahi-Tefahot',
  isracard: 'Isracard', amex: 'American Express', max: 'Max', visaCal: 'CAL',
};

function instant(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function periodFor(period: string, date: string) {
  return period === 'yearly'
    ? { startDate: `${date.slice(0, 4)}-01-01`, endDate: date }
    : { startDate: `${date.slice(0, 7)}-01`, endDate: date };
}

function paceFor(period: string, financialDate: string, spent: number, limit: number) {
  const [year, month, day] = financialDate.split('-').map(Number);
  const totalDays = period === 'yearly'
    ? (new Date(Date.UTC(year + 1, 0, 1)).getTime() - new Date(Date.UTC(year, 0, 1)).getTime()) / 86_400_000
    : new Date(Date.UTC(year, month, 0)).getUTCDate();
  const elapsedDays = period === 'yearly'
    ? Math.max(1, Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86_400_000) + 1)
    : Math.max(1, day);
  const expectedSpent = limit * elapsedDays / totalDays;
  const projectedSpent = spent * totalDays / elapsedDays;
  return {
    elapsedDays,
    totalDays,
    expectedSpent: projectMobileMoney(expectedSpent),
    projectedSpent: projectMobileMoney(projectedSpent),
    state: projectedSpent <= limit ? 'on_track' as const : spent > expectedSpent ? 'ahead' as const : 'behind' as const,
  };
}

function latestSync(db: MoneyMonitorDatabase): MobilePlanningSnapshot['latestSync'] {
  const session = db.select().from(schema.scrapeSessions).orderBy(desc(schema.scrapeSessions.id)).limit(1).get();
  if (!session) return { state: 'neverRun', startedAt: null, completedAt: null, accountsSucceeded: 0, accountsAttentionNeeded: 0 };
  const logs = db.select().from(schema.scrapeLogs).where(eq(schema.scrapeLogs.sessionId, session.id)).all();
  const attention = logs.filter((log) => log.status !== 'completed').length;
  const succeeded = logs.filter((log) => log.status === 'completed').length;
  const state = session.status === 'running' ? 'running'
    : session.status === 'cancelled' ? 'cancelled'
    : session.status === 'completed' && attention === 0 ? 'completed'
    : session.status === 'completed' ? 'partial'
    : attention > 0 ? 'attentionNeeded' : 'failed';
  return { state, startedAt: instant(session.startedAt), completedAt: instant(session.completedAt), accountsSucceeded: succeeded, accountsAttentionNeeded: attention };
}

/**
 * Projects only the Phase 3 mobile allowlist. It never passes a desktop row,
 * raw primary key, account number, scraper diagnostic, note, or exchange-rate blob through.
 */
export function createProductionMobilePlanningPorts(options: ProductionMobilePlanningPortOptions) {
  const publicId = createMobilePublicIdProjector(options.publicIdKey);
  function read(context: Readonly<{ generatedAt: string; financialDate: string }>): MobilePlanningSnapshot {
    const categoryRows = options.db.select().from(schema.categories).all();
    const categoryId = new Map(categoryRows.map((category) => [category.name, category.id]));
    const budgets = options.db.select().from(schema.budgets).where(eq(schema.budgets.isActive, true)).all().flatMap((budget) => {
      let names: string[];
      try { names = JSON.parse(budget.categoryNames) as string[]; } catch { return []; }
      if (!Array.isArray(names) || names.some((name) => typeof name !== 'string')) return [];
      const periodRange = periodFor(budget.period, context.financialDate);
      // Positive credits/refunds and transfers must never reduce budget spending.
      const spent = names.length === 0 ? 0 : (options.db.select({ total: sql<number>`COALESCE(SUM(ABS(${schema.transactions.chargedAmount})), 0)` })
        .from(schema.transactions)
        .where(and(sql`${schema.transactions.category} IN (${sql.join(names.map((name) => sql`${name}`), sql`, `)})`, gte(schema.transactions.date, periodRange.startDate), lte(schema.transactions.date, periodRange.endDate), eq(schema.transactions.ignored, false), sql`${schema.transactions.chargedAmount} < 0`, sql`${schema.transactions.type} != 'transfer'`))
        .get()?.total ?? 0);
      const remaining = budget.amount - spent;
      const ratio = budget.amount > 0 ? spent / budget.amount : 0;
      return [{
        id: publicId('budget', budget.id), displayName: boundedMobileText(budget.name, 'Budget', 80),
        period: budget.period === 'yearly' ? 'yearly' as const : 'monthly' as const, periodRange,
        limit: projectMobileMoney(budget.amount), spent: projectMobileMoney(spent), remaining: projectMobileMoney(remaining),
        state: remaining < 0 ? 'over_budget' as const : remaining === 0 ? 'at_limit' as const : ratio >= budget.alertThreshold / 100 ? 'watch' as const : 'on_track' as const,
        pace: paceFor(budget.period, context.financialDate, spent, budget.amount),
        includedCategories: names.flatMap((name) => {
          const id = categoryId.get(name); return id === undefined ? [] : [{ id: publicId('category', id), label: boundedMobileText(categoryRows.find((entry) => entry.id === id)?.label ?? name, 'Category', 80) }];
        }),
      }];
    });
    const accounts = options.db.select().from(schema.accounts).all().map((account) => {
      const type = account.accountType === 'credit_card' ? 'credit_card' as const : account.accountType === 'bank' ? 'bank' as const : 'unknown' as const;
      const lastSuccessfulSyncAt = instant(account.lastScrapedAt);
      return {
        id: publicId('account', account.id), institutionName: INSTITUTIONS[account.companyId] ?? boundedMobileText(account.companyId.replace(/[-_]+/g, ' '), 'Institution', 80),
        displayName: boundedMobileText(account.displayName, 'Account', 80), type, identifierMask: maskAccountIdentifier(account.accountNumber), currencyCode: 'ILS' as const,
        state: account.isActive ? 'active' as const : 'inactive' as const,
        freshness: { status: lastSuccessfulSyncAt ? 'current' as const : 'unknown' as const, lastSuccessfulSyncAt },
        balance: type === 'bank' && account.balance !== null ? projectMobileMoney(account.balance) : null,
      };
    });
    const assets = options.db.select().from(schema.assets).where(eq(schema.assets.isActive, true)).all()
      .map((asset) => {
        // A many-to-one join would duplicate an asset when it has historical
        // snapshots. Read exactly the newest local valuation instead.
        const value = options.db.select({ value: schema.assetSnapshots.totalValueIls })
          .from(schema.assetSnapshots)
          .where(eq(schema.assetSnapshots.assetId, asset.id))
          .orderBy(desc(schema.assetSnapshots.date), desc(schema.assetSnapshots.id))
          .limit(1)
          .get()?.value ?? null;
        return {
        id: publicId('asset', asset.id), displayName: boundedMobileText(asset.name, 'Asset', 100), type: boundedMobileText(asset.type, 'Asset', 40),
        liquidity: asset.liquidity === 'liquid' ? 'liquid' as const : asset.liquidity ? 'illiquid' as const : 'unknown' as const,
        currentValue: value === null ? null : projectMobileMoney(value), state: value === null ? 'unavailable' as const : 'available' as const,
      };
      });
    const liabilitiesTotal = options.db.select({ total: sql<number>`COALESCE(SUM(${schema.liabilities.currentBalance}), 0)` }).from(schema.liabilities).where(eq(schema.liabilities.isActive, true)).get()?.total ?? 0;
    const availableBankBalances = accounts.flatMap((account) => account.type === 'bank' && account.balance !== null ? [Number(account.balance.value)] : []);
    const bankBalancesTotal = availableBankBalances.reduce((total, amount) => total + amount, 0);
    const availableAssets = assets.filter((asset) => asset.currentValue !== null).map((asset) => Number(asset.currentValue!.value));
    const assetsTotal = bankBalancesTotal + availableAssets.reduce((total, amount) => total + amount, 0);
    const partial = accounts.some((account) => account.type === 'bank' && account.balance === null) || assets.some((asset) => asset.currentValue === null);
    return {
      financialDate: context.financialDate, calculatedAt: context.generatedAt, baseCurrencyCode: 'ILS', budgets,
      netWorth: { state: partial ? 'partial' : 'available', total: projectMobileMoney(assetsTotal - liabilitiesTotal), assetsTotal: projectMobileMoney(assetsTotal), liabilitiesTotal: projectMobileMoney(liabilitiesTotal), bankBalancesTotal: projectMobileMoney(bankBalancesTotal) },
      accounts, assets, latestSync: latestSync(options.db),
    };
  }
  return Object.freeze({ read });
}
