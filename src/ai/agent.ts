import { query } from '@anthropic-ai/claude-agent-sdk';
import { eq, isNull, inArray, gte, lte, and } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from '../config.js';
import { db } from '../db/connection.js';
import { transactions, categories } from '../db/schema.js';
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
  buildSaveMemoryTool,
  buildMcpServerFromTools,
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
import { claudeDir } from '../paths.js';

const LOCAL_CLAUDE_DIR = claudeDir;

// Resolve the bundled cli.js path. In packaged Electron apps, swap app.asar → app.asar.unpacked
// so the system node can execute it (system node can't read from asar archives).
const sdkDir = dirname(fileURLToPath(import.meta.resolve('@anthropic-ai/claude-agent-sdk')));
const CLAUDE_CLI_PATH = join(sdkDir, 'cli.js').replace('app.asar', 'app.asar.unpacked');

function formatTransactionForPrompt(t: Transaction): string {
  const meta = parseMeta(t.meta);
  const bankCat = meta.bankCategory ? ` | bank-category: ${meta.bankCategory}` : '';
  const memo = t.memo ? ` | memo: ${t.memo}` : '';
  return `ID:${t.id} | ${t.date} | ₪${t.chargedAmount} | ${t.description}${memo}${bankCat}`;
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
  | { type: 'text_delta'; text: string }
  | { type: 'status'; text: string }
  | { type: 'result'; text: string }
  | { type: 'error'; text: string };

// ── Tool status mapping ─────────────────────────────────────────────────────────

const MCP_SERVER_NAME = 'financial-tools';

const TOOL_STATUS: Record<string, string> = {
  query_transactions: 'Searching transactions...',
  get_spending_summary: 'Analyzing spending...',
  get_account_balances: 'Checking account balances...',
  compare_periods: 'Comparing periods...',
  get_spending_trends: 'Analyzing trends...',
  detect_recurring_transactions: 'Detecting recurring charges...',
  get_top_merchants: 'Finding top merchants...',
  categorize_transaction: 'Categorizing transaction...',
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

function describeToolCall(toolName: string): string {
  return TOOL_STATUS[toolName.replace(`mcp__${MCP_SERVER_NAME}__`, '')] ?? 'Processing...';
}

// ── Chat ────────────────────────────────────────────────────────────────────────

function getCategoriesWithRules(): CategoryWithRules[] {
  return db.select({
    name: categories.name,
    rules: categories.rules,
    ignoredFromStats: categories.ignoredFromStats,
  }).from(categories).all();
}

export async function* chat(conversationHistory: ChatMessage[]): AsyncGenerator<ChatEvent> {
  const cats = getCategoriesWithRules();
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

  const memory = readMemory();
  const systemPrompt = buildFinancialAdvisorPrompt(categoryNames, ignoredCategoryNames, memory);
  const server = buildMcpServerFromTools(MCP_SERVER_NAME, [
    buildQueryTransactionsTool(),
    buildGetSpendingSummaryTool(),
    buildGetAccountBalancesTool(),
    buildComparePeriodsTool(),
    buildGetSpendingTrendsTool(),
    buildDetectRecurringTransactionsTool(),
    buildGetTopMerchantsTool(),
    buildCategorizeTransactionTool(categoryNames),
    buildSaveMemoryTool(),
    buildGetNetWorthTool(),
    buildGetAssetDetailsTool(),
    buildGetLiabilitiesTool(),
    buildGetNetWorthHistoryTool(),
    buildManageAssetTool(),
    buildManageHoldingTool(),
    buildRecordMovementTool(),
    buildManageLiabilityTool(),
  ]);

  for await (const msg of query({
    prompt,
    options: {
      model: config.ANTHROPIC_MODEL,
      systemPrompt,
      pathToClaudeCodeExecutable: CLAUDE_CLI_PATH,
      mcpServers: { [MCP_SERVER_NAME]: server },
      tools: [],
      allowedTools: [`mcp__${MCP_SERVER_NAME}__*`],
      maxTurns: 8,
      includePartialMessages: true,
      env: { ...process.env, CLAUDE_CONFIG_DIR: LOCAL_CLAUDE_DIR },
    },
  })) {
    if (msg.type === 'stream_event') {
      const event = msg.event;
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        yield { type: 'status', text: describeToolCall(event.content_block.name) };
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'text_delta', text: event.delta.text };
      }
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

  const catRows = getCategoriesWithRules();
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
      pathToClaudeCodeExecutable: CLAUDE_CLI_PATH,
      tools: [],
      maxTurns: 1,
      env: { ...process.env, CLAUDE_CONFIG_DIR: LOCAL_CLAUDE_DIR },
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
  const uncategorized = ids && ids.length > 0
    ? db.select().from(transactions)
        .where(and(isNull(transactions.category), inArray(transactions.id, ids)))
        .all()
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
  const conditions = [];
  if (startDate) conditions.push(gte(transactions.date, startDate));
  if (endDate) conditions.push(lte(transactions.date, endDate));

  const toProcess = conditions.length > 0
    ? db.select().from(transactions).where(and(...conditions)).all()
    : db.select().from(transactions).all();

  return categorizeBatch(toProcess);
}
