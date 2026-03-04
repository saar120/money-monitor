import { query } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config.js';
import { buildBatchCategorizerPrompt } from './prompts.js';
import { parseMeta } from '../shared/types.js';
import type { Transaction } from '../shared/types.js';
import { runOrchestrator, getLastConsultedAgents } from './agents/orchestrator.js';
import type { AgentType, AgentResult } from './agents/types.js';

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
): Array<{ id: number; category: string; needsReview?: boolean; reviewReason?: string }> {
  const clean = cleanJsonResponse(text);
  const results: Array<{ id: number; category: string; needsReview?: boolean; reviewReason?: string }> = JSON.parse(clean);
  return results.filter(({ id, category }) => validIds.has(id) && validCategories.has(category));
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

async function getCategoriesWithRules(): Promise<{ name: string; rules: string | null }[]> {
  const { db } = await import('../db/connection.js');
  const { categories } = await import('../db/schema.js');
  return db.select({ name: categories.name, rules: categories.rules }).from(categories).all();
}

export async function chat(conversationHistory: ChatMessage[]): Promise<AgentResult> {
  const cats = await getCategoriesWithRules();
  const categoryNames = cats.map(c => c.name);

  const historyLines = conversationHistory.slice(0, -1).map(m =>
    `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`
  );
  const lastMsg = conversationHistory[conversationHistory.length - 1];
  const prompt = historyLines.length > 0
    ? `Previous conversation:\n${historyLines.join('\n\n')}\n\nCurrent question: ${lastMsg.content}`
    : lastMsg.content;

  return runOrchestrator(prompt, categoryNames);
}

/** Returns which agents were consulted in the last chat call. */
export { getLastConsultedAgents };
export type { AgentType, AgentResult };

export async function batchCategorize(
  batchSize: number = 50,
  ids?: number[],
): Promise<{ categorized: number }> {
  const { eq, isNull } = await import('drizzle-orm');
  const { db } = await import('../db/connection.js');
  const { transactions } = await import('../db/schema.js');

  const catRows = await getCategoriesWithRules();
  const categoryNames = catRows.map(r => r.name);
  if (categoryNames.length === 0) return { categorized: 0 };

  const uncategorized = ids && ids.length > 0
    ? db.select().from(transactions)
        .where(isNull(transactions.category))
        .all()
        .filter(t => ids.includes(t.id))
    : db.select().from(transactions)
        .where(isNull(transactions.category))
        .limit(batchSize)
        .all();

  if (uncategorized.length === 0) return { categorized: 0 };

  const validIds = new Set(uncategorized.map(t => t.id));
  const validCategories = new Set(categoryNames);

  const txnList = uncategorized.map(formatTransactionForPrompt).join('\n');

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
    for (const { id, category, needsReview, reviewReason } of processCategoryResults(text, validCategories, validIds)) {
      db.update(transactions)
        .set({
          category,
          needsReview: needsReview === true,
          reviewReason: needsReview === true ? (reviewReason ?? null) : null,
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

export async function recategorize(
  startDate?: string,
  endDate?: string,
): Promise<{ categorized: number }> {
  const { eq, gte, lte, and } = await import('drizzle-orm');
  const { db } = await import('../db/connection.js');
  const { transactions } = await import('../db/schema.js');

  const catRows = await getCategoriesWithRules();
  const categoryNames = catRows.map(r => r.name);
  if (categoryNames.length === 0) return { categorized: 0 };

  const conditions = [];
  if (startDate) conditions.push(gte(transactions.date, startDate));
  if (endDate) conditions.push(lte(transactions.date, endDate));

  const toProcess = conditions.length > 0
    ? db.select().from(transactions).where(and(...conditions)).all()
    : db.select().from(transactions).all();

  if (toProcess.length === 0) return { categorized: 0 };

  const validIds = new Set(toProcess.map(t => t.id));
  const validCategories = new Set(categoryNames);

  const txnList = toProcess.map(formatTransactionForPrompt).join('\n');

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
    for (const { id, category, needsReview, reviewReason } of processCategoryResults(text, validCategories, validIds)) {
      db.update(transactions)
        .set({
          category,
          needsReview: needsReview === true,
          reviewReason: needsReview === true ? (reviewReason ?? null) : null,
        })
        .where(eq(transactions.id, id))
        .run();
      categorized++;
    }
  } catch {
    // malformed model response — return 0
  }

  return { categorized };
}
