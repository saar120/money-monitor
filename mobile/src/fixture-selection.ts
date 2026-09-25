import Constants from 'expo-constants';
import { Settings } from 'react-native';
import {
  fixtureScenarios,
  type FixtureScenario,
  type FixtureScenarioName,
} from './fixtures';
import { currentLanguage } from './locale-state';
import { fixtureCategoryName, t } from './translations';

function fixtureFreshnessDetail(detail: string): string {
  const labels: Record<string, string> = {
    'Updated just now': t('updatedJustNow'),
    'Updated 14 min ago': t('updatedMinutes', { count: 14 }),
    'Updated 2 hr ago': t('updatedHours', { count: 2 }),
    'Last valued 3 days ago': t('lastValuedDays', { count: 3 }),
    'Updated 5 min ago': t('updatedMinutes', { count: 5 }),
    'Connection needs attention': t('connectionNeedsAttention'),
    'Last updated yesterday': t('lastUpdatedYesterday'),
    'Never synced': t('neverSynced'),
    'Last updated 3 days ago': t('updatedDays', { count: 3 }),
    'Last valued 8 days ago': t('lastValuedDays', { count: 8 }),
  };
  return labels[detail] ?? detail;
}

const configuredScenario = Constants.expoConfig?.extra?.fixtureScenario;
const launchScenario =
  (typeof configuredScenario === 'string' ? configuredScenario : undefined) ||
  (Settings.get('MM_FIXTURE_SCENARIO') as string | undefined);
const launchRefreshDelay = Number(Settings.get('MM_FIXTURE_REFRESH_DELAY_MS')) || 0;
let fixtureMode = Boolean(launchScenario && launchScenario in fixtureScenarios);

let selectedScenario: FixtureScenarioName =
  launchScenario && launchScenario in fixtureScenarios
    ? (launchScenario as FixtureScenarioName)
    : 'normal';

export function selectFixtureScenario(value: string | string[] | undefined): void {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate && candidate in fixtureScenarios) {
    selectedScenario = candidate as FixtureScenarioName;
    fixtureMode = true;
  }
}

export function isFixtureMode(): boolean {
  return fixtureMode;
}

export function getFixtureScenario(): FixtureScenario {
  const scenario = fixtureScenarios[selectedScenario];
  if (currentLanguage() !== 'he') return scenario;
  return {
    ...scenario,
    categories: scenario.categories.map((category) => ({
      ...category,
      name: fixtureCategoryName(category.name),
    })),
    budgets: scenario.budgets.map((budget) => ({
      ...budget,
      name:
        budget.name === 'Monthly spending' ? t('monthlySpending') : fixtureCategoryName(budget.name),
      categoryNames: budget.categoryNames?.map(fixtureCategoryName) ?? null,
    })),
    merchants: scenario.merchants.map((merchant) => ({
      ...merchant,
      category: fixtureCategoryName(merchant.category),
    })),
    transactions: scenario.transactions.map((transaction) => ({
      ...transaction,
      category: fixtureCategoryName(transaction.category),
    })),
    freshness: scenario.freshness.map((account) => ({
      ...account,
      detail: fixtureFreshnessDetail(account.detail),
    })),
  };
}

export function getFixtureRefreshDelay(): number {
  return Math.max(0, launchRefreshDelay);
}
