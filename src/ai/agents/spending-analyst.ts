import { query } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../../config.js';
import { buildSpendingAnalystPrompt } from '../prompts.js';
import {
  buildMcpServerFromTools,
  buildQueryTransactionsTool,
  buildGetSpendingSummaryTool,
  buildGetAccountBalancesTool,
  buildComparePeriodsTool,
  buildGetSpendingTrendsTool,
  buildGetTopMerchantsTool,
} from '../tools.js';

export async function runSpendingAnalyst(
  question: string,
  categoryNames: string[],
): Promise<string> {
  const systemPrompt = buildSpendingAnalystPrompt(categoryNames);

  const server = buildMcpServerFromTools('spending-tools', [
    buildQueryTransactionsTool(),
    buildGetSpendingSummaryTool(),
    buildGetAccountBalancesTool(),
    buildComparePeriodsTool(),
    buildGetSpendingTrendsTool(),
    buildGetTopMerchantsTool(),
  ]);

  for await (const msg of query({
    prompt: question,
    options: {
      model: config.ANTHROPIC_MODEL,
      systemPrompt,
      mcpServers: { 'spending-tools': server },
      tools: [],
      allowedTools: ['mcp__spending-tools__*'],
      maxTurns: 8,
    },
  })) {
    if (msg.type === 'result') {
      if (msg.subtype === 'success') return msg.result;
      if (msg.subtype === 'error_max_turns') {
        return 'I reached the maximum analysis steps. Please try a more specific spending question.';
      }
      throw new Error(`Spending analyst error (${msg.subtype})`);
    }
  }

  return 'No spending analysis generated.';
}
