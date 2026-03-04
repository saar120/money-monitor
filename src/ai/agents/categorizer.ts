import { buildCategorizerPrompt } from '../prompts.js';
import {
  buildQueryTransactionsTool,
  buildCategorizeTransactionTool,
} from '../tools.js';
import { runAgent } from './types.js';

export async function runCategorizer(question: string, categoryNames: string[], ignoredCategoryNames: string[] = []): Promise<string> {
  return runAgent(question, {
    serverName: 'categorizer-tools',
    systemPrompt: buildCategorizerPrompt(categoryNames, ignoredCategoryNames),
    tools: [
      buildQueryTransactionsTool(),
      buildCategorizeTransactionTool(categoryNames),
    ],
    maxTurns: 6,
    errorLabel: 'Categorizer',
  });
}
