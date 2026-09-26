import { Agent } from '@earendil-works/pi-agent-core';
import { Type } from '@earendil-works/pi-ai';
import type { AssistantMessage, UserMessage, Message, ImageContent } from '@earendil-works/pi-ai';
import type { AgentMessage, AgentEvent } from '@earendil-works/pi-agent-core';
import { config, getConfiguredThinkingLevel } from '../config.js';
import { extractAssistantText, resolveModel } from './ai-utils.js';
import { db } from '../db/connection.js';
import { categories } from '../db/schema.js';
import { buildFinancialAdvisorPrompt, partitionCategories, withMemory } from './prompts.js';
import type { CategoryWithRules } from './prompts.js';
import {
  buildQueryTransactionsTool,
  buildGetSpendingSummaryTool,
  buildGetAccountBalancesTool,
  buildComparePeriodsTool,
  buildGetSpendingTrendsTool,
  buildDetectRecurringTransactionsTool,
  buildGetTopMerchantsTool,
  buildCategorizeTransactionTool,
  buildSaveMemoryTool,
  buildUpdateMemoryTool,
  buildAddCategoryTool,
  buildGetCategoryRulesTool,
  buildUpdateCategoryRulesTool,
  buildGetLatestScrapeTransactionsTool,
} from './tools.js';
import {
  buildGetNetWorthTool,
  buildGetAssetDetailsTool,
  buildGetLiabilitiesTool,
  buildGetNetWorthHistoryTool,
  buildManageAssetTool,
  buildManageHoldingTool,
  buildRecordMovementTool,
  buildManageLiabilityTool,
} from './asset-tools.js';
import { buildGetBudgetProgressTool, buildManageBudgetTool } from './budget-tools.js';
import { buildGetAlertSettingsTool, buildUpdateAlertSettingsTool } from './alert-tools.js';
import { buildGenerateTableImageTool } from './image-tools.js';
import { resolveApiKey, loadCredentials } from './auth.js';
import { createAgentTool } from './tool-adapter.js';
import { makeAdvisorChart } from './chart-data.js';
import type { AdvisorChart } from './advisor-chart.js';

// Load OAuth credentials at module init
loadCredentials();

/** Check if the environment has an API key that pi-ai would discover for this provider. */
function hasEnvApiKey(provider: string): boolean {
  const envMap: Record<string, string[]> = {
    anthropic: ['ANTHROPIC_API_KEY'],
    openai: ['OPENAI_API_KEY'],
    'openai-codex': ['OPENAI_API_KEY'],
    'opencode-go': ['OPENCODE_API_KEY'],
    google: ['GEMINI_API_KEY'],
    groq: ['GROQ_API_KEY'],
    xai: ['XAI_API_KEY'],
    openrouter: ['OPENROUTER_API_KEY'],
    mistral: ['MISTRAL_API_KEY'],
  };
  const vars = envMap[provider];
  return vars ? vars.some((v) => !!process.env[v]) : false;
}

// ── Chat types ──────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type ChatEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'status'; text: string }
  | { type: 'result'; text: string }
  | { type: 'error'; text: string }
  | { type: 'chart'; chart: AdvisorChart };

const MOBILE_READ_TOOLS = new Set([
  'query_transactions',
  'get_spending_summary',
  'get_account_balances',
  'compare_periods',
  'get_spending_trends',
  'detect_recurring_transactions',
  'get_top_merchants',
  'get_net_worth',
  'get_asset_details',
  'get_liabilities',
  'get_net_worth_history',
  'get_budget_progress',
  'get_latest_scrape_transactions',
]);

// ── Tool status mapping ─────────────────────────────────────────────────────────

const TOOL_STATUS: Record<string, string> = {
  query_transactions: 'Searching transactions...',
  get_spending_summary: 'Analyzing spending...',
  get_account_balances: 'Checking account balances...',
  compare_periods: 'Comparing periods...',
  get_spending_trends: 'Analyzing trends...',
  detect_recurring_transactions: 'Detecting recurring charges...',
  get_top_merchants: 'Finding top merchants...',
  categorize_transaction: 'Categorizing transaction...',
  add_category: 'Adding category...',
  get_category_rules: 'Reading category rules...',
  update_category_rules: 'Updating category rules...',
  save_memory: 'Saving to memory...',
  update_memory: 'Updating memory...',
  get_net_worth: 'Calculating net worth...',
  get_asset_details: 'Looking up asset details...',
  get_liabilities: 'Checking liabilities...',
  get_net_worth_history: 'Loading net worth history...',
  manage_asset: 'Updating asset...',
  manage_holding: 'Updating holding...',
  record_movement: 'Recording movement...',
  manage_liability: 'Updating liability...',
  get_budget_progress: 'Checking budget progress...',
  manage_budget: 'Updating budget...',
  get_alert_settings: 'Checking alert settings...',
  update_alert_settings: 'Updating alert settings...',
  get_latest_scrape_transactions: 'Looking up latest scrape results...',
  generate_table_image: 'Generating table image...',
};

// ── Helpers ──────────────────────────────────────────────────────────────────────

/** Read at call time so settings changes take effect without restart. */
function getMaxTurns() {
  return config.AI_MAX_TURNS;
}

/** Convert ChatMessage history to Pi Message objects for multi-turn context. */
function convertHistoryToMessages(history: ChatMessage[]): Message[] {
  return history.map((m): Message => {
    if (m.role === 'user') {
      return { role: 'user', content: m.content, timestamp: Date.now() } as UserMessage;
    }
    // Assistant messages need full structure — metadata fields are placeholders
    // since convertToLlm only extracts role + content for the API request
    return {
      role: 'assistant',
      content: [{ type: 'text', text: m.content }],
      api: '' as any,
      provider: '',
      model: '',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } as any,
      stopReason: 'stop',
      timestamp: Date.now(),
    } as AssistantMessage;
  });
}

// ── Chat ────────────────────────────────────────────────────────────────────────

function getCategoriesWithRules(): CategoryWithRules[] {
  return db
    .select({
      name: categories.name,
      rules: categories.rules,
      ignoredFromStats: categories.ignoredFromStats,
    })
    .from(categories)
    .all();
}

export async function* chat(
  conversationHistory: ChatMessage[],
  images?: ImageContent[],
  options: { mobileReadOnly?: boolean } = {},
): AsyncGenerator<ChatEvent> {
  const cats = getCategoriesWithRules();
  const { ignored } = partitionCategories(cats);
  const categoryNames = cats.map((c) => c.name);
  const ignoredCategoryNames = ignored.map((c) => c.name);
  const firstLetter = conversationHistory.at(-1)?.content.match(/[A-Za-z\u0590-\u05FF]/)?.[0];
  const mobileLanguage = firstLetter && /[\u0590-\u05FF]/.test(firstLetter) ? 'he' : 'en';

  const systemPrompt =
    withMemory(buildFinancialAdvisorPrompt(categoryNames, ignoredCategoryNames)) +
    (options.mobileReadOnly
      ? '\nThis iPhone chat is read-only. Reply in the language of the latest user message, including Hebrew when the user writes in Hebrew. Keep saved category and merchant names unchanged. Use show_financial_chart when its scope matches the question and a graph helps; its plotted values come from Mac calculations. For comparisons and detailed results, use compact Markdown tables with a header and separator row so the iPhone can display them as tables. Only include values returned by tools.'
      : '');

  const { model, provider } = resolveModel();

  // Pre-validate auth before entering the agent loop.
  // The pi-agent-core library uses a fire-and-forget async IIFE internally,
  // so any error from within the loop becomes an unhandled promise rejection.
  // By checking here, we fail fast with a clear error to the user.
  const apiKey = await resolveApiKey(provider);
  if (!apiKey && !hasEnvApiKey(provider)) {
    yield {
      type: 'error',
      text: 'Authentication expired or missing. Please re-authenticate via Settings → AI Provider, or set your API key environment variable.',
    };
    return;
  }

  const allTools = [
    buildQueryTransactionsTool(),
    buildGetSpendingSummaryTool(),
    buildGetAccountBalancesTool(),
    buildComparePeriodsTool(),
    buildGetSpendingTrendsTool(),
    buildDetectRecurringTransactionsTool(),
    buildGetTopMerchantsTool(),
    buildCategorizeTransactionTool(categoryNames),
    buildAddCategoryTool(),
    buildGetCategoryRulesTool(),
    buildUpdateCategoryRulesTool(),
    buildSaveMemoryTool(),
    buildUpdateMemoryTool(),
    buildGetNetWorthTool(),
    buildGetAssetDetailsTool(),
    buildGetLiabilitiesTool(),
    buildGetNetWorthHistoryTool(),
    buildManageAssetTool(),
    buildManageHoldingTool(),
    buildRecordMovementTool(),
    buildManageLiabilityTool(),
    buildGetBudgetProgressTool(),
    buildManageBudgetTool(),
    buildGetAlertSettingsTool(),
    buildUpdateAlertSettingsTool(),
    buildGetLatestScrapeTransactionsTool(),
    buildGenerateTableImageTool(),
  ];
  let chart: AdvisorChart | null = null;
  const tools = options.mobileReadOnly
    ? [
        ...allTools.filter((tool) => MOBILE_READ_TOOLS.has(tool.name)),
        createAgentTool({
          name: 'show_financial_chart',
          description:
            'Show an interactive graph of Mac-calculated overall monthly spending or spending by category for a chosen month. Call only when the chart scope matches the question.',
          label: 'Preparing chart',
          parameters: Type.Object({
            kind: Type.Union([Type.Literal('spending_trend'), Type.Literal('category_spending')]),
            months: Type.Optional(
              Type.Number({ description: 'Months for a spending trend, 1-12' }),
            ),
            month: Type.Optional(
              Type.String({
                description: 'YYYY-MM for spending by category; defaults to current month',
              }),
            ),
          }),
          execute: async (args) => {
            chart = makeAdvisorChart(args.kind, args.months, args.month, mobileLanguage);
            return chart ? JSON.stringify(chart) : 'No chart data is available for this period.';
          },
        }),
      ]
    : allTools;

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      tools,
      thinkingLevel: getConfiguredThinkingLevel(model.reasoning) ?? 'off',
    },
    getApiKey: resolveApiKey,
  });

  // Queue-based bridge: subscribe() events → async generator
  type QueueItem = ChatEvent | { done: true };
  const queue: QueueItem[] = [];
  let waiting: (() => void) | null = null;
  const push = (item: QueueItem) => {
    queue.push(item);
    if (waiting) {
      waiting();
      waiting = null;
    }
  };
  const pull = () =>
    new Promise<void>((r) => {
      if (queue.length > 0) r();
      else waiting = r;
    });

  let turnCount = 0;

  agent.subscribe((event: AgentEvent) => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      push({ type: 'text_delta', text: event.assistantMessageEvent.delta });
    }
    if (event.type === 'tool_execution_start') {
      push({ type: 'status', text: TOOL_STATUS[event.toolName] ?? 'Processing...' });
    }
    if (event.type === 'turn_end') {
      turnCount++;
      if (turnCount >= getMaxTurns()) {
        agent.abort();
        push({
          type: 'result',
          text: 'I reached the maximum number of steps. Please try a more specific question.',
        });
        push({ done: true });
      }
    }
    if (event.type === 'agent_end') {
      // Check if the agent ended due to a provider error
      const lastMsg = event.messages[event.messages.length - 1];
      if (lastMsg && 'stopReason' in lastMsg && lastMsg.stopReason === 'error') {
        const errorText =
          'errorMessage' in lastMsg && lastMsg.errorMessage
            ? String(lastMsg.errorMessage)
            : 'The AI provider returned an error. Please check your API key and try again.';
        push({ type: 'error', text: errorText });
        push({ done: true });
        return;
      }
      const finalText = extractAssistantText(event.messages);
      if (chart) push({ type: 'chart', chart });
      push({ type: 'result', text: finalText });
      push({ done: true });
    }
  });

  // Load conversation history as proper multi-turn messages
  const priorMessages = convertHistoryToMessages(conversationHistory.slice(0, -1));
  if (priorMessages.length > 0) {
    agent.state.messages = priorMessages as AgentMessage[];
  }

  const lastMsg = conversationHistory[conversationHistory.length - 1];
  const promptPromise = agent.prompt(lastMsg.content, images).catch((err) => {
    push({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    push({ done: true });
  });

  while (true) {
    await pull();
    while (queue.length > 0) {
      const item = queue.shift()!;
      if ('done' in item) {
        await promptPromise;
        return;
      }
      yield item;
    }
  }
}

export { batchCategorize, recategorize } from './categorization/index.js';
