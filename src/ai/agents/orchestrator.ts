import { query } from '@anthropic-ai/claude-agent-sdk';
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { config } from '../../config.js';
import { buildOrchestratorPrompt } from '../prompts.js';
import { runSpendingAnalyst } from './spending-analyst.js';
import { runBudgetAdvisor } from './budget-advisor.js';
import { runCategorizer } from './categorizer.js';
import { runSubscriptionTracker } from './subscription-tracker.js';
import type { AgentType, AgentResult } from './types.js';

function buildOrchestratorMcpServer(categoryNames: string[], consultedAgents: AgentType[]) {
  return createSdkMcpServer({
    name: 'orchestrator-tools',
    version: '1.0.0',
    tools: [
      tool(
        'consult_spending_analyst',
        'Delegate a question to the Spending Analyst agent. Use for questions about spending amounts, breakdowns by category/account/period, period comparisons, spending trends, top merchants, and transaction searches.',
        {
          question: z.string().describe('The full user question to pass to the spending analyst'),
        },
        async (args) => {
          consultedAgents.push('spending_analyst');
          const result = await runSpendingAnalyst(args.question, categoryNames);
          return { content: [{ type: 'text' as const, text: result }] };
        },
      ),
      tool(
        'consult_budget_advisor',
        'Delegate a question to the Budget Advisor agent. Use for questions about saving money, budget optimization, financial advice, identifying wasteful spending, unusual charges, and cost reduction recommendations.',
        {
          question: z.string().describe('The full user question to pass to the budget advisor'),
        },
        async (args) => {
          consultedAgents.push('budget_advisor');
          const result = await runBudgetAdvisor(args.question, categoryNames);
          return { content: [{ type: 'text' as const, text: result }] };
        },
      ),
      tool(
        'consult_categorizer',
        'Delegate a question to the Categorizer agent. Use when the user wants to categorize transactions, fix categories, review uncategorized transactions, or understand how transactions are classified.',
        {
          question: z.string().describe('The full user question or instruction to pass to the categorizer'),
        },
        async (args) => {
          consultedAgents.push('categorizer');
          const result = await runCategorizer(args.question, categoryNames);
          return { content: [{ type: 'text' as const, text: result }] };
        },
      ),
      tool(
        'consult_subscription_tracker',
        'Delegate a question to the Subscription Tracker agent. Use for questions about recurring charges, subscriptions, memberships, bills, regular payments, and recurring cost analysis.',
        {
          question: z.string().describe('The full user question to pass to the subscription tracker'),
        },
        async (args) => {
          consultedAgents.push('subscription_tracker');
          const result = await runSubscriptionTracker(args.question);
          return { content: [{ type: 'text' as const, text: result }] };
        },
      ),
    ],
  });
}

export async function runOrchestrator(
  prompt: string,
  categoryNames: string[],
): Promise<AgentResult> {
  const consultedAgents: AgentType[] = [];

  const systemPrompt = buildOrchestratorPrompt();
  const server = buildOrchestratorMcpServer(categoryNames, consultedAgents);

  for await (const msg of query({
    prompt,
    options: {
      model: config.ANTHROPIC_MODEL,
      systemPrompt,
      mcpServers: { 'orchestrator-tools': server },
      tools: [],
      allowedTools: ['mcp__orchestrator-tools__*'],
      maxTurns: 5,
    },
  })) {
    if (msg.type === 'result') {
      if (msg.subtype === 'success') {
        const primaryAgent = consultedAgents[0] ?? 'orchestrator';
        return { response: msg.result, agent: primaryAgent };
      }
      if (msg.subtype === 'error_max_turns') {
        return {
          response: 'I reached the maximum number of steps. Please try a more specific question.',
          agent: 'orchestrator',
        };
      }
      throw new Error(`Orchestrator error (${msg.subtype})`);
    }
  }

  return { response: 'No response generated.', agent: 'orchestrator' };
}
