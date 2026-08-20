import { and, asc, eq, lte } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { projectMobileMoney } from './mobile-transaction-projection.js';
import type { MobileNetWorthHistory, MobileNetWorthHistoryQuery } from './net-worth-history-contract.js';

type MoneyMonitorDatabase = BetterSQLite3Database<typeof schema>;

export interface ProductionMobileNetWorthHistoryPortOptions { db: MoneyMonitorDatabase; }

function dateAtMonthsBefore(financialDate: string, months: number): string {
  const [year, month, day] = financialDate.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 - months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

function monthlyDatePoints(startDate: string, endDate: string): string[] {
  const [startYear, startMonth] = startDate.split('-').map(Number);
  const [endYear, endMonth] = endDate.split('-').map(Number);
  const result: string[] = [];
  let cursorYear = startYear;
  let cursorMonth = startMonth;
  while (cursorYear < endYear || (cursorYear === endYear && cursorMonth <= endMonth)) {
    result.push(`${cursorYear}-${String(cursorMonth).padStart(2, '0')}-01`);
    cursorMonth += 1;
    if (cursorMonth === 13) { cursorMonth = 1; cursorYear += 1; }
  }
  if (result[result.length - 1] !== endDate) result.push(endDate);
  return result;
}

function earliestDate(dates: Array<string | null | undefined>): string | null {
  const valid = dates.filter((date): date is string => Boolean(date && /^\d{4}-\d{2}-\d{2}$/.test(date)));
  return valid.length === 0 ? null : valid.reduce((earliest, date) => date < earliest ? date : earliest);
}

function projectIlsMoney(value: number): { value: string; currencyCode: 'ILS' } {
  const projected = projectMobileMoney(value, 'ILS');
  return { value: projected.value, currencyCode: 'ILS' };
}

function startDateFor(query: MobileNetWorthHistoryQuery, financialDate: string, earliestAvailable: string | null): string {
  switch (query.range) {
    case '3M': return dateAtMonthsBefore(financialDate, 3);
    case '6M': return dateAtMonthsBefore(financialDate, 6);
    case '1Y': return dateAtMonthsBefore(financialDate, 12);
    case 'All': return earliestAvailable && earliestAvailable <= financialDate ? earliestAvailable : financialDate;
  }
}

/**
 * Projects aggregate ILS values only. Historical source tables do not record
 * every component on every day, therefore each series is explicitly marked as
 * an estimate by the contract rather than implying audit-grade precision.
 */
export function createProductionMobileNetWorthHistoryPorts(options: ProductionMobileNetWorthHistoryPortOptions) {
  function read(query: Readonly<MobileNetWorthHistoryQuery>, context: Readonly<{ financialDate: string }>): MobileNetWorthHistory {
    const bankAccounts = options.db.select({ id: schema.accounts.id }).from(schema.accounts)
      .where(and(eq(schema.accounts.accountType, 'bank'), eq(schema.accounts.isActive, true))).all();
    const activeAssets = options.db.select({ id: schema.assets.id }).from(schema.assets)
      .where(eq(schema.assets.isActive, true)).all();
    const liabilities = options.db.select({ currentBalance: schema.liabilities.currentBalance, startDate: schema.liabilities.startDate })
      .from(schema.liabilities).where(eq(schema.liabilities.isActive, true)).all();

    const balanceHistory = options.db.select({ accountId: schema.accountBalanceHistory.accountId, date: schema.accountBalanceHistory.date, balance: schema.accountBalanceHistory.balance })
      .from(schema.accountBalanceHistory).where(lte(schema.accountBalanceHistory.date, context.financialDate))
      .orderBy(asc(schema.accountBalanceHistory.accountId), asc(schema.accountBalanceHistory.date)).all();
    const snapshots = options.db.select({ assetId: schema.assetSnapshots.assetId, date: schema.assetSnapshots.date, totalValueIls: schema.assetSnapshots.totalValueIls })
      .from(schema.assetSnapshots).where(lte(schema.assetSnapshots.date, context.financialDate))
      .orderBy(asc(schema.assetSnapshots.assetId), asc(schema.assetSnapshots.date)).all();

    const earliestAvailable = earliestDate([
      ...balanceHistory.map((entry) => entry.date),
      ...snapshots.map((entry) => entry.date),
      ...liabilities.map((entry) => entry.startDate),
    ]);
    const startDate = startDateFor(query, context.financialDate, earliestAvailable);
    const balancesByAccount = new Map<number, Array<{ date: string; balance: number }>>();
    balanceHistory.forEach((entry) => {
      const entries = balancesByAccount.get(entry.accountId) ?? [];
      entries.push(entry); balancesByAccount.set(entry.accountId, entries);
    });
    const snapshotsByAsset = new Map<number, Array<{ date: string; totalValueIls: number }>>();
    snapshots.forEach((entry) => {
      const entries = snapshotsByAsset.get(entry.assetId) ?? [];
      entries.push(entry); snapshotsByAsset.set(entry.assetId, entries);
    });

    const points = monthlyDatePoints(startDate, context.financialDate).map((date) => {
      const bankBalancesTotal = bankAccounts.reduce((total, account) => {
        const latest = balancesByAccount.get(account.id)?.findLast((entry) => entry.date <= date);
        return total + (latest?.balance ?? 0);
      }, 0);
      const assetsTotal = activeAssets.reduce((total, asset) => {
        const entries = snapshotsByAsset.get(asset.id) ?? [];
        // The desktop service carries the first available valuation backwards;
        // this mobile endpoint makes that estimate explicit in its contract.
        const value = entries.findLast((entry) => entry.date <= date)?.totalValueIls ?? entries[0]?.totalValueIls ?? 0;
        return total + value;
      }, 0);
      const liabilitiesTotal = liabilities.reduce((total, liability) =>
        total + (!liability.startDate || liability.startDate <= date ? liability.currentBalance : 0), 0);
      return {
        date,
        total: projectIlsMoney(bankBalancesTotal + assetsTotal - liabilitiesTotal),
        assetsTotal: projectIlsMoney(assetsTotal),
        liabilitiesTotal: projectIlsMoney(liabilitiesTotal),
        bankBalancesTotal: projectIlsMoney(bankBalancesTotal),
      };
    });

    return {
      financialDate: context.financialDate,
      range: query.range,
      period: { startDate, endDate: context.financialDate },
      baseCurrencyCode: 'ILS',
      estimatedHistory: true,
      estimationMethod: 'latest_known_values_carried_forward',
      points,
    };
  }
  return Object.freeze({ read });
}
