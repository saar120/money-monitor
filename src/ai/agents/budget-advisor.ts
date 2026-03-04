import { buildBudgetAdvisorPrompt } from '../prompts.js';
import {
  buildQueryTransactionsTool,
  buildGetSpendingSummaryTool,
  buildGetSpendingTrendsTool,
  buildDetectRecurringTransactionsTool,
  buildGetTopMerchantsTool,
} from '../tools.js';
import { runAgent } from './types.js';

export async function runBudgetAdvisor(question: string, categoryNames: string[], ignoredCategoryNames: string[] = []): Promise<string> {
  return runAgent(question, {
    serverName: 'budget-tools',
    systemPrompt: buildBudgetAdvisorPrompt(categoryNames, ignoredCategoryNames),
    tools: [
      buildQueryTransactionsTool(),
      buildGetSpendingSummaryTool(),
      buildGetSpendingTrendsTool(),
      buildDetectRecurringTransactionsTool(),
      buildGetTopMerchantsTool(),
    ],
    maxTurns: 8,
    errorLabel: 'Budget advisor',
  });
}
