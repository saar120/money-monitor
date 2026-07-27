import {
  buildQueryTransactionsTool,
  buildGetSpendingSummaryTool,
  buildGetAccountBalancesTool,
  buildComparePeriodsTool,
  buildGetSpendingTrendsTool,
  buildDetectRecurringTransactionsTool,
  buildGetTopMerchantsTool,
  buildCategorizeTransactionTool,
  buildSaveMemoryTool,
  buildUpdateMemoryTool,
  buildAddCategoryTool,
  buildGetCategoryRulesTool,
  buildUpdateCategoryRulesTool,
  buildGetLatestScrapeTransactionsTool,
} from './tools.js';
import {
  buildGetNetWorthTool,
  buildGetAssetDetailsTool,
  buildGetLiabilitiesTool,
  buildGetNetWorthHistoryTool,
  buildManageAssetTool,
  buildManageHoldingTool,
  buildRecordMovementTool,
  buildManageLiabilityTool,
} from './asset-tools.js';
import { buildGetBudgetProgressTool, buildManageBudgetTool } from './budget-tools.js';
import { buildGetAlertSettingsTool, buildUpdateAlertSettingsTool } from './alert-tools.js';
import { buildGenerateTableImageTool } from './image-tools.js';

export type MobileAdvisorToolAccess = 'read' | 'deny';

/**
 * The sole inventory of Advisor tools. Mobile is deny-by-default: every new
 * desktop tool must receive an explicit classification before it can be used.
 */
const advisorToolDefinitions = [
  { name: 'query_transactions', mobileAccess: 'read', build: (_: string[]) => buildQueryTransactionsTool() },
  { name: 'get_spending_summary', mobileAccess: 'read', build: (_: string[]) => buildGetSpendingSummaryTool() },
  { name: 'get_account_balances', mobileAccess: 'read', build: (_: string[]) => buildGetAccountBalancesTool() },
  { name: 'compare_periods', mobileAccess: 'read', build: (_: string[]) => buildComparePeriodsTool() },
  { name: 'get_spending_trends', mobileAccess: 'read', build: (_: string[]) => buildGetSpendingTrendsTool() },
  { name: 'detect_recurring_transactions', mobileAccess: 'read', build: (_: string[]) => buildDetectRecurringTransactionsTool() },
  { name: 'get_top_merchants', mobileAccess: 'read', build: (_: string[]) => buildGetTopMerchantsTool() },
  { name: 'categorize_transaction', mobileAccess: 'deny', build: (categories: string[]) => buildCategorizeTransactionTool(categories) },
  { name: 'add_category', mobileAccess: 'deny', build: (_: string[]) => buildAddCategoryTool() },
  { name: 'get_category_rules', mobileAccess: 'read', build: (_: string[]) => buildGetCategoryRulesTool() },
  { name: 'update_category_rules', mobileAccess: 'deny', build: (_: string[]) => buildUpdateCategoryRulesTool() },
  { name: 'save_memory', mobileAccess: 'deny', build: (_: string[]) => buildSaveMemoryTool() },
  { name: 'update_memory', mobileAccess: 'deny', build: (_: string[]) => buildUpdateMemoryTool() },
  { name: 'get_net_worth', mobileAccess: 'read', build: (_: string[]) => buildGetNetWorthTool() },
  { name: 'get_asset_details', mobileAccess: 'read', build: (_: string[]) => buildGetAssetDetailsTool() },
  { name: 'get_liabilities', mobileAccess: 'read', build: (_: string[]) => buildGetLiabilitiesTool() },
  { name: 'get_net_worth_history', mobileAccess: 'read', build: (_: string[]) => buildGetNetWorthHistoryTool() },
  { name: 'manage_asset', mobileAccess: 'deny', build: (_: string[]) => buildManageAssetTool() },
  { name: 'manage_holding', mobileAccess: 'deny', build: (_: string[]) => buildManageHoldingTool() },
  { name: 'record_movement', mobileAccess: 'deny', build: (_: string[]) => buildRecordMovementTool() },
  { name: 'manage_liability', mobileAccess: 'deny', build: (_: string[]) => buildManageLiabilityTool() },
  { name: 'get_budget_progress', mobileAccess: 'read', build: (_: string[]) => buildGetBudgetProgressTool() },
  { name: 'manage_budget', mobileAccess: 'deny', build: (_: string[]) => buildManageBudgetTool() },
  { name: 'get_alert_settings', mobileAccess: 'read', build: (_: string[]) => buildGetAlertSettingsTool() },
  { name: 'update_alert_settings', mobileAccess: 'deny', build: (_: string[]) => buildUpdateAlertSettingsTool() },
  { name: 'get_latest_scrape_transactions', mobileAccess: 'read', build: (_: string[]) => buildGetLatestScrapeTransactionsTool() },
  { name: 'generate_table_image', mobileAccess: 'deny', build: (_: string[]) => buildGenerateTableImageTool() },
] as const;

export const ALL_DESKTOP_ADVISOR_TOOL_NAMES = advisorToolDefinitions.map(({ name }) => name);
export const MOBILE_ADVISOR_READ_TOOL_NAMES = advisorToolDefinitions
  .filter(({ mobileAccess }) => mobileAccess === 'read')
  .map(({ name }) => name);
export const MOBILE_ADVISOR_DENIED_TOOL_NAMES = advisorToolDefinitions
  .filter(({ mobileAccess }) => mobileAccess === 'deny')
  .map(({ name }) => name);

export function classifyMobileAdvisorTool(name: string): MobileAdvisorToolAccess {
  return advisorToolDefinitions.find((tool) => tool.name === name)?.mobileAccess ?? 'deny';
}

export function buildDesktopAdvisorTools(categoryNames: string[]) {
  return advisorToolDefinitions.map((tool) => tool.build(categoryNames));
}

/** Builds only the tools explicitly approved for the mobile read-only Advisor. */
export function buildMobileReadOnlyAdvisorTools(categoryNames: string[]) {
  return advisorToolDefinitions
    .filter((tool) => tool.mobileAccess === 'read')
    .map((tool) => tool.build(categoryNames));
}
