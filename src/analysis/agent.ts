/**
 * Financial analysis agent powered by Claude.
 *
 * Uses a manual agentic loop with tool use so Claude can query the
 * transaction database, compute summaries, and provide natural-language
 * financial insights.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ANALYSIS_TOOLS, executeTool } from './tools.js';
import type { TransactionRepository } from '../storage/repositories/transactions.js';
import type { AccountRepository } from '../storage/repositories/accounts.js';

const SYSTEM_PROMPT = `You are a personal financial analyst assistant. You have access to the user's bank and credit card transaction data through a set of tools.

Your job is to:
- Answer questions about spending patterns, savings, and financial trends
- Identify areas where the user is spending the most
- Spot unusual or large transactions
- Provide actionable insights and recommendations
- Categorize transactions when asked

Guidelines:
- Always query the actual data before making claims — never guess
- Present monetary amounts in the original currency (usually ILS)
- When analyzing trends, compare month-over-month when possible
- Be concise but thorough — use bullet points and clear structure
- If the data is limited or missing, say so honestly
- When categorizing, use common categories like: groceries, dining, transportation, utilities, entertainment, health, shopping, subscriptions, education, housing, insurance, transfers, salary, other`;

const MAX_TOOL_ROUNDS = 15;

export interface AnalysisResult {
  answer: string;
  toolCalls: number;
}

export class FinancialAnalysisAgent {
  private client: Anthropic;

  constructor(
    apiKey: string,
    private accountRepo: AccountRepository,
    private transactionRepo: TransactionRepository,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  /** Run a free-form analysis question through the agent */
  async analyze(question: string): Promise<AnalysisResult> {
    const messages: Anthropic.Messages.MessageParam[] = [
      { role: 'user', content: question },
    ];

    let toolCalls = 0;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: ANALYSIS_TOOLS,
        messages,
      });

      // If Claude is done (no more tool calls), extract final text
      if (response.stop_reason === 'end_turn') {
        const textBlocks = response.content.filter(
          (b): b is Anthropic.Messages.TextBlock => b.type === 'text',
        );
        return {
          answer: textBlocks.map((b) => b.text).join('\n'),
          toolCalls,
        };
      }

      // Process any tool use blocks
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
      );

      if (toolUseBlocks.length === 0) {
        // No tool calls and not end_turn — extract whatever text there is
        const textBlocks = response.content.filter(
          (b): b is Anthropic.Messages.TextBlock => b.type === 'text',
        );
        return {
          answer:
            textBlocks.map((b) => b.text).join('\n') ||
            'No analysis could be generated.',
          toolCalls,
        };
      }

      // Append assistant response (with tool_use blocks) to conversation
      messages.push({ role: 'assistant', content: response.content });

      // Execute each tool and collect results
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] =
        toolUseBlocks.map((block) => {
          toolCalls++;
          const result = executeTool(
            block.name,
            block.input as Record<string, unknown>,
            this.accountRepo,
            this.transactionRepo,
          );
          return {
            type: 'tool_result' as const,
            tool_use_id: block.id,
            content: result,
          };
        });

      messages.push({ role: 'user', content: toolResults });
    }

    return {
      answer: 'Analysis reached the maximum number of reasoning steps.',
      toolCalls,
    };
  }

  /**
   * Auto-categorize uncategorized transactions by asking Claude to
   * look at descriptions and assign sensible categories in bulk.
   */
  async autoCategorize(): Promise<AnalysisResult> {
    return this.analyze(
      `Please look at all uncategorized transactions (category is null) and categorize them based on their descriptions.
Use the bulk_categorize tool to efficiently categorize groups of similar transactions by description pattern.
Common categories: groceries, dining, transportation, utilities, entertainment, health, shopping, subscriptions, education, housing, insurance, transfers, salary, other.
Start by querying uncategorized transactions, identify patterns in descriptions, then bulk-categorize them.
Report back what you categorized and how many transactions were affected.`,
    );
  }
}
