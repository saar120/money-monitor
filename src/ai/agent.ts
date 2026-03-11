import { Agent } from '@mariozechner/pi-agent-core';
import { getModel, completeSimple } from '@mariozechner/pi-ai';
import type { AssistantMessage, UserMessage, Message } from '@mariozechner/pi-ai';
import type { AgentMessage, AgentEvent } from '@mariozechner/pi-agent-core';
import { eq, isNull, inArray, gte, lte, and } from 'drizzle-orm';
import { config, parseModelSpec, getAIModelSpec, getBatchModelSpec } from '../config.js';
import { db } from '../db/connection.js';
import { transactions, categories } from '../db/schema.js';
import {
  buildBatchCategorizerPrompt,
  buildFinancialAdvisorPrompt,
  partitionCategories,
} from './prompts.js';
import type { CategoryWithRules } from './prompts.js';
import { parseMeta } from '../shared/types.js';
import type { Transaction } from '../shared/types.js';
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
  buildAddCategoryTool,
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
import { readMemory } from './memory.js';
import { resolveApiKey, loadCredentials } from './auth.js';

// Load OAuth credentials at module init
loadCredentials();

/** Check if the environment has an API key that pi-ai would discover for this provider. */
function hasEnvApiKey(provider: string): boolean {
  const envMap: Record<string, string[]> = {
    anthropic: ['ANTHROPIC_API_KEY'],
    openai: ['OPENAI_API_KEY'],
    google: ['GEMINI_API_KEY'],
    groq: ['GROQ_API_KEY'],
    xai: ['XAI_API_KEY'],
    openrouter: ['OPENROUTER_API_KEY'],
    mistral: ['MISTRAL_API_KEY'],
  };
  const vars = envMap[provider];
  return vars ? vars.some((v) => !!process.env[v]) : false;
}

function formatTransactionForPrompt(t: Transaction): string {
  const meta = parseMeta(t.meta);
  const bankCat = meta.bankCategory ? ` | bank-category: ${meta.bankCategory}` : '';
  const memo = t.memo ? ` | memo: ${t.memo}` : '';
  return `ID:${t.id} | ${t.date} | ₪${t.chargedAmount} | ${t.description}${memo}${bankCat}`;
}

/** Strip markdown code fences that the model may wrap around JSON. */
function cleanJsonResponse(text: string): string {
  return text
    .replace(/^```(?:json)?\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim();
}

/** Parse the model's JSON response, validate categories, and return valid results. */
function processCategoryResults(
  text: string,
  validCategories: Set<string>,
  validIds: Set<number>,
): Array<{ id: number; category: string; confidence?: number; reviewReason?: string }> {
  const clean = cleanJsonResponse(text);
  const results: Array<{
    id: number;
    category: string;
    confidence?: number;
    reviewReason?: string;
  }> = JSON.parse(clean);
  return results.filter(({ id, category }) => validIds.has(id) && validCategories.has(category));
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
  | { type: 'error'; text: string };

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
  save_memory: 'Saving to memory...',
  get_net_worth: 'Calculating net worth...',
  get_asset_details: 'Looking up asset details...',
  get_liabilities: 'Checking liabilities...',
  get_net_worth_history: 'Loading net worth history...',
  manage_asset: 'Updating asset...',
  manage_holding: 'Updating holding...',
  record_movement: 'Recording movement...',
  manage_liability: 'Updating liability...',
};

// ── Helpers ──────────────────────────────────────────────────────────────────────

/** Read at call time so settings changes take effect without restart. */
function getMaxTurns() {
  return config.AI_MAX_TURNS;
}

/** Extract text from the last assistant message in a list. */
function extractAssistantText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg && 'role' in msg && msg.role === 'assistant') {
      const assistantMsg = msg as AssistantMessage;
      return assistantMsg.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('');
    }
  }
  return '';
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

export async function* chat(conversationHistory: ChatMessage[]): AsyncGenerator<ChatEvent> {
  const cats = getCategoriesWithRules();
  const { ignored } = partitionCategories(cats);
  const categoryNames = cats.map((c) => c.name);
  const ignoredCategoryNames = ignored.map((c) => c.name);

  const memory = readMemory();
  const systemPrompt = buildFinancialAdvisorPrompt(categoryNames, ignoredCategoryNames, memory);

  const { provider, model: modelName } = parseModelSpec(getAIModelSpec());

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

  // getModel is strictly typed; dynamic strings from config need a cast on the result
  const model = (getModel as (p: string, m: string) => ReturnType<typeof getModel>)(
    provider,
    modelName,
  );

  const tools = [
    buildQueryTransactionsTool(),
    buildGetSpendingSummaryTool(),
    buildGetAccountBalancesTool(),
    buildComparePeriodsTool(),
    buildGetSpendingTrendsTool(),
    buildDetectRecurringTransactionsTool(),
    buildGetTopMerchantsTool(),
    buildCategorizeTransactionTool(categoryNames),
    buildAddCategoryTool(),
    buildSaveMemoryTool(),
    buildGetNetWorthTool(),
    buildGetAssetDetailsTool(),
    buildGetLiabilitiesTool(),
    buildGetNetWorthHistoryTool(),
    buildManageAssetTool(),
    buildManageHoldingTool(),
    buildRecordMovementTool(),
    buildManageLiabilityTool(),
  ];

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      tools,
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
      push({ type: 'result', text: finalText });
      push({ done: true });
    }
  });

  // Load conversation history as proper multi-turn messages
  const priorMessages = convertHistoryToMessages(conversationHistory.slice(0, -1));
  if (priorMessages.length > 0) {
    agent.replaceMessages(priorMessages as AgentMessage[]);
  }

  const lastMsg = conversationHistory[conversationHistory.length - 1];
  const promptPromise = agent.prompt(lastMsg.content).catch((err) => {
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

// ── Batch categorization ────────────────────────────────────────────────────────

/** Shared LLM call + result persistence for batch categorization. */
async function categorizeBatch(txns: Transaction[]): Promise<{ categorized: number }> {
  if (txns.length === 0) return { categorized: 0 };

  const catRows = getCategoriesWithRules();
  const categoryNames = catRows.map((r) => r.name);
  if (categoryNames.length === 0) return { categorized: 0 };
  const ignoredCategories = new Set(catRows.filter((r) => r.ignoredFromStats).map((r) => r.name));

  const validIds = new Set(txns.map((t) => t.id));
  const validCategories = new Set(categoryNames);
  const txnList = txns.map(formatTransactionForPrompt).join('\n');

  const { provider, model: modelName } = parseModelSpec(getBatchModelSpec());
  // getModel is strictly typed; dynamic strings from config need a cast on the result
  const model = (getModel as (p: string, m: string) => ReturnType<typeof getModel>)(
    provider,
    modelName,
  );

  // Resolve OAuth key if available
  const oauthKey = await resolveApiKey(provider);

  const response = await completeSimple(
    model,
    {
      systemPrompt: buildBatchCategorizerPrompt(catRows),
      messages: [
        {
          role: 'user',
          content: `Categorize these transactions:\n${txnList}`,
          timestamp: Date.now(),
        },
      ],
    },
    {
      ...(oauthKey ? { apiKey: oauthKey } : {}),
    },
  );

  const text = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');

  let categorized = 0;
  try {
    for (const { id, category, confidence, reviewReason } of processCategoryResults(
      text,
      validCategories,
      validIds,
    )) {
      const needsReview = confidence !== undefined && confidence < 0.8;
      db.update(transactions)
        .set({
          category,
          confidence: confidence ?? null,
          needsReview,
          reviewReason: needsReview ? (reviewReason ?? 'Low confidence categorization') : null,
          ignored: ignoredCategories.has(category),
        })
        .where(eq(transactions.id, id))
        .run();
      categorized++;
    }
  } catch (err) {
    console.error(
      '[AI] Failed to process categorization results:',
      err instanceof Error ? err.message : err,
    );
  }

  return { categorized };
}

export async function batchCategorize(
  batchSize: number = 50,
  ids?: number[],
): Promise<{ categorized: number }> {
  const uncategorized =
    ids && ids.length > 0
      ? db
          .select()
          .from(transactions)
          .where(and(isNull(transactions.category), inArray(transactions.id, ids)))
          .all()
      : db.select().from(transactions).where(isNull(transactions.category)).limit(batchSize).all();

  return categorizeBatch(uncategorized);
}

export async function recategorize(
  startDate?: string,
  endDate?: string,
): Promise<{ categorized: number }> {
  const conditions = [];
  if (startDate) conditions.push(gte(transactions.date, startDate));
  if (endDate) conditions.push(lte(transactions.date, endDate));

  const toProcess =
    conditions.length > 0
      ? db
          .select()
          .from(transactions)
          .where(and(...conditions))
          .all()
      : db.select().from(transactions).all();

  return categorizeBatch(toProcess);
}
