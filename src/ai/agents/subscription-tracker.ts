import { query } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../../config.js';
import { buildSubscriptionTrackerPrompt } from '../prompts.js';
import {
  buildMcpServerFromTools,
  buildQueryTransactionsTool,
  buildGetAccountBalancesTool,
  buildDetectRecurringTransactionsTool,
} from '../tools.js';

export async function runSubscriptionTracker(
  question: string,
): Promise<string> {
  const systemPrompt = buildSubscriptionTrackerPrompt();

  const server = buildMcpServerFromTools('subscription-tools', [
    buildQueryTransactionsTool(),
    buildGetAccountBalancesTool(),
    buildDetectRecurringTransactionsTool(),
  ]);

  for await (const msg of query({
    prompt: question,
    options: {
      model: config.ANTHROPIC_MODEL,
      systemPrompt,
      mcpServers: { 'subscription-tools': server },
      tools: [],
      allowedTools: ['mcp__subscription-tools__*'],
      maxTurns: 6,
    },
  })) {
    if (msg.type === 'result') {
      if (msg.subtype === 'success') return msg.result;
      if (msg.subtype === 'error_max_turns') {
        return 'I reached the maximum analysis steps. Please try a more specific subscription question.';
      }
      throw new Error(`Subscription tracker error (${msg.subtype})`);
    }
  }

  return 'No subscription analysis generated.';
}
