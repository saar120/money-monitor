import { buildSubscriptionTrackerPrompt } from '../prompts.js';
import {
  buildQueryTransactionsTool,
  buildGetAccountBalancesTool,
  buildDetectRecurringTransactionsTool,
} from '../tools.js';
import { runAgent } from './types.js';

export async function runSubscriptionTracker(question: string): Promise<string> {
  return runAgent(question, {
    serverName: 'subscription-tools',
    systemPrompt: buildSubscriptionTrackerPrompt(),
    tools: [
      buildQueryTransactionsTool(),
      buildGetAccountBalancesTool(),
      buildDetectRecurringTransactionsTool(),
    ],
    maxTurns: 6,
    errorLabel: 'Subscription tracker',
  });
}
