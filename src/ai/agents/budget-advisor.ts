import { query } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../../config.js';
import { buildBudgetAdvisorPrompt } from '../prompts.js';
import {
  buildMcpServerFromTools,
  buildQueryTransactionsTool,
  buildGetSpendingSummaryTool,
  buildGetSpendingTrendsTool,
  buildDetectRecurringTransactionsTool,
  buildGetTopMerchantsTool,
} from '../tools.js';

export async function runBudgetAdvisor(
  question: string,
  categoryNames: string[],
): Promise<string> {
  const systemPrompt = buildBudgetAdvisorPrompt(categoryNames);

  const server = buildMcpServerFromTools('budget-tools', [
    buildQueryTransactionsTool(),
    buildGetSpendingSummaryTool(),
    buildGetSpendingTrendsTool(),
    buildDetectRecurringTransactionsTool(),
    buildGetTopMerchantsTool(),
  ]);

  for await (const msg of query({
    prompt: question,
    options: {
      model: config.ANTHROPIC_MODEL,
      systemPrompt,
      mcpServers: { 'budget-tools': server },
      tools: [],
      allowedTools: ['mcp__budget-tools__*'],
      maxTurns: 8,
    },
  })) {
    if (msg.type === 'result') {
      if (msg.subtype === 'success') return msg.result;
      if (msg.subtype === 'error_max_turns') {
        return 'I reached the maximum analysis steps. Please try a more specific budget question.';
      }
      throw new Error(`Budget advisor error (${msg.subtype})`);
    }
  }

  return 'No budget advice generated.';
}
