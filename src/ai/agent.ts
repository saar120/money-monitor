import { query } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config.js';
import { buildBatchCategorizerPrompt, buildFinancialAdvisorPrompt, partitionCategories } from './prompts.js';
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
  buildMcpServerFromTools,
} from './tools.js';

function formatTransactionForPrompt(t: Transaction): string {
  const meta = parseMeta(t.meta);
  const bankCat = meta.bankCategory ? ` | bank-category: ${meta.bankCategory}` : '';
  return `ID:${t.id} | ${t.date} | ₪${t.chargedAmount} | ${t.description}${bankCat}`;
}

/** Strip markdown code fences that the model may wrap around JSON. */
function cleanJsonResponse(text: string): string {
  return text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
}

/** Parse the model's JSON response, validate categories, and return valid results. */
function processCategoryResults(
  text: string,
  validCategories: Set<string>,
  validIds: Set<number>,
): Array<{ id: number; category: string; confidence?: number; reviewReason?: string }> {
  const clean = cleanJsonResponse(text);
  const results: Array<{ id: number; category: string; confidence?: number; reviewReason?: string }> = JSON.parse(clean);
  return results.filter(({ id, category }) => validIds.has(id) && validCategories.has(category));
}

// ── Chat types ──────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type ChatEvent =
  | { type: 'status'; text: string }
  | { type: 'result'; text: string };

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
};

function describeToolCall(toolName: string): string {
  return TOOL_STATUS[toolName.replace('mcp__financial-tools__', '')] ?? 'Processing...';
}

// ── Chat ────────────────────────────────────────────────────────────────────────

async function getCategoriesWithRules(): Promise<CategoryWithRules[]> {
  const { db } = await import('../db/connection.js');
  const { categories } = await import('../db/schema.js');
  return db.select({
    name: categories.name,
    rules: categories.rules,
    ignoredFromStats: categories.ignoredFromStats,
  }).from(categories).all();
}

export async function* chat(conversationHistory: ChatMessage[]): AsyncGenerator<ChatEvent> {
  const cats = await getCategoriesWithRules();
  const { ignored } = partitionCategories(cats);
  const categoryNames = cats.map(c => c.name);
  const ignoredCategoryNames = ignored.map(c => c.name);

  const historyLines = conversationHistory.slice(0, -1).map(m =>
    `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`
  );
  const lastMsg = conversationHistory[conversationHistory.length - 1];
  const prompt = historyLines.length > 0
    ? `Previous conversation:\n${historyLines.join('\n\n')}\n\nCurrent question: ${lastMsg.content}`
    : lastMsg.content;

  const systemPrompt = buildFinancialAdvisorPrompt(categoryNames, ignoredCategoryNames);
  const server = buildMcpServerFromTools('financial-tools', [
    buildQueryTransactionsTool(),
    buildGetSpendingSummaryTool(),
    buildGetAccountBalancesTool(),
    buildComparePeriodsTool(),
    buildGetSpendingTrendsTool(),
    buildDetectRecurringTransactionsTool(),
    buildGetTopMerchantsTool(),
    buildCategorizeTransactionTool(categoryNames),
  ]);

  for await (const msg of query({
    prompt,
    options: {
      model: config.ANTHROPIC_MODEL,
      systemPrompt,
      mcpServers: { 'financial-tools': server },
      tools: [],
      allowedTools: ['mcp__financial-tools__*'],
      maxTurns: 8,
    },
  })) {
    if (msg.type === 'tool_call') {
      yield { type: 'status', text: describeToolCall(msg.tool_name) };
    }
    if (msg.type === 'result' && msg.subtype === 'success') {
      yield { type: 'result', text: msg.result };
    }
    if (msg.type === 'result' && msg.subtype === 'error_max_turns') {
      yield { type: 'result', text: 'I reached the maximum number of steps. Please try a more specific question.' };
    }
  }
}

// ── Batch categorization ────────────────────────────────────────────────────────

/** Shared LLM call + result persistence for batch categorization. */
async function categorizeBatch(txns: Transaction[]): Promise<{ categorized: number }> {
  if (txns.length === 0) return { categorized: 0 };

  const { eq } = await import('drizzle-orm');
  const { db } = await import('../db/connection.js');
  const { transactions } = await import('../db/schema.js');

  const catRows = await getCategoriesWithRules();
  const categoryNames = catRows.map(r => r.name);
  if (categoryNames.length === 0) return { categorized: 0 };
  const ignoredCategories = new Set(catRows.filter(r => r.ignoredFromStats).map(r => r.name));

  const validIds = new Set(txns.map(t => t.id));
  const validCategories = new Set(categoryNames);
  const txnList = txns.map(formatTransactionForPrompt).join('\n');

  let text = '';
  for await (const msg of query({
    prompt: `Categorize these transactions:\n${txnList}`,
    options: {
      model: config.ANTHROPIC_MODEL,
      systemPrompt: buildBatchCategorizerPrompt(catRows),
      tools: [],
      maxTurns: 1,
    },
  })) {
    if (msg.type === 'result' && msg.subtype === 'success') {
      text = msg.result;
    }
  }

  let categorized = 0;
  try {
    for (const { id, category, confidence, reviewReason } of processCategoryResults(text, validCategories, validIds)) {
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
  } catch {
    // If parsing fails, return 0 — the model response was malformed
  }

  return { categorized };
}

export async function batchCategorize(
  batchSize: number = 50,
  ids?: number[],
): Promise<{ categorized: number }> {
  const { isNull } = await import('drizzle-orm');
  const { db } = await import('../db/connection.js');
  const { transactions } = await import('../db/schema.js');

  const uncategorized = ids && ids.length > 0
    ? db.select().from(transactions)
        .where(isNull(transactions.category))
        .all()
        .filter(t => ids.includes(t.id))
    : db.select().from(transactions)
        .where(isNull(transactions.category))
        .limit(batchSize)
        .all();

  return categorizeBatch(uncategorized);
}

export async function recategorize(
  startDate?: string,
  endDate?: string,
): Promise<{ categorized: number }> {
  const { gte, lte, and } = await import('drizzle-orm');
  const { db } = await import('../db/connection.js');
  const { transactions } = await import('../db/schema.js');

  const conditions = [];
  if (startDate) conditions.push(gte(transactions.date, startDate));
  if (endDate) conditions.push(lte(transactions.date, endDate));

  const toProcess = conditions.length > 0
    ? db.select().from(transactions).where(and(...conditions)).all()
    : db.select().from(transactions).all();

  return categorizeBatch(toProcess);
}
