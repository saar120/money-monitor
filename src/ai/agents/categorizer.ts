import { query } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../../config.js';
import { buildCategorizerPrompt } from '../prompts.js';
import {
  buildMcpServerFromTools,
  buildQueryTransactionsTool,
  buildCategorizeTransactionTool,
} from '../tools.js';

export async function runCategorizer(
  question: string,
  categoryNames: string[],
): Promise<string> {
  const systemPrompt = buildCategorizerPrompt(categoryNames);

  const server = buildMcpServerFromTools('categorizer-tools', [
    buildQueryTransactionsTool(),
    buildCategorizeTransactionTool(categoryNames),
  ]);

  for await (const msg of query({
    prompt: question,
    options: {
      model: config.ANTHROPIC_MODEL,
      systemPrompt,
      mcpServers: { 'categorizer-tools': server },
      tools: [],
      allowedTools: ['mcp__categorizer-tools__*'],
      maxTurns: 6,
    },
  })) {
    if (msg.type === 'result') {
      if (msg.subtype === 'success') return msg.result;
      if (msg.subtype === 'error_max_turns') {
        return 'I reached the maximum categorization steps. Please try with fewer transactions.';
      }
      throw new Error(`Categorizer error (${msg.subtype})`);
    }
  }

  return 'No categorization result generated.';
}
