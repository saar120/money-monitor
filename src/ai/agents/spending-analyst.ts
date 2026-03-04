import { buildSpendingAnalystPrompt } from '../prompts.js';
import {
  buildQueryTransactionsTool,
  buildGetSpendingSummaryTool,
  buildGetAccountBalancesTool,
  buildComparePeriodsTool,
  buildGetSpendingTrendsTool,
  buildGetTopMerchantsTool,
} from '../tools.js';
import { runAgent } from './types.js';

export async function runSpendingAnalyst(question: string, categoryNames: string[], ignoredCategoryNames: string[] = []): Promise<string> {
  return runAgent(question, {
    serverName: 'spending-tools',
    systemPrompt: buildSpendingAnalystPrompt(categoryNames, ignoredCategoryNames),
    tools: [
      buildQueryTransactionsTool(),
      buildGetSpendingSummaryTool(),
      buildGetAccountBalancesTool(),
      buildComparePeriodsTool(),
      buildGetSpendingTrendsTool(),
      buildGetTopMerchantsTool(),
    ],
    maxTurns: 8,
    errorLabel: 'Spending analyst',
  });
}
