import { query } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config.js';
import { buildFinancialAdvisorPrompt, formatCategoryList } from './prompts.js';
import { buildFinancialMcpServer } from './tools.js';
import { parseMeta } from '../shared/types.js';
import type { Transaction } from '../shared/types.js';

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

export async function chat(conversationHistory: ChatMessage[]): Promise<string> {
  const cats = await getCategoriesWithRules();
  const categoryNames = cats.map(c => c.name);
  const systemPrompt = buildFinancialAdvisorPrompt(cats);
  const server = buildFinancialMcpServer(categoryNames);

  const historyLines = conversationHistory.slice(0, -1).map(m =>
    `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`
  );
  const lastMsg = conversationHistory[conversationHistory.length - 1];
  const prompt = historyLines.length > 0
    ? `Previous conversation:\n${historyLines.join('\n\n')}\n\nCurrent question: ${lastMsg.content}`
    : lastMsg.content;

  for await (const msg of query({
    prompt,
    options: {
      model: config.ANTHROPIC_MODEL,
      systemPrompt,
      mcpServers: { 'financial-tools': server },
      tools: [],
      allowedTools: ['mcp__financial-tools__*'],
      maxTurns: 10,
    },
  })) {
    if (msg.type === 'result') {
      if (msg.subtype === 'success') return msg.result;
      if (msg.subtype === 'error_max_turns') {
        return 'I reached the maximum number of analysis steps. Please try a more specific question.';
      }
      throw new Error(`Agent error (${msg.subtype})`);
    }
  }

  return 'No response generated.';
}

export async function batchCategorize(
  batchSize: number = 50,
  ids?: number[],
): Promise<{ categorized: number }> {
  const { eq, isNull } = await import('drizzle-orm');
  const { db } = await import('../db/connection.js');
  const { transactions, categories } = await import('../db/schema.js');

  const catRows = db.select({ name: categories.name, rules: categories.rules }).from(categories).all();
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
      systemPrompt: `You are a transaction categorizer for an Israeli user's bank transactions. Assign each transaction one of these categories:

${formatCategoryList(catRows)}

If you are confident in the category, set "needsReview" to false.
If the transaction is ambiguous — the description is vague, multiple categories could apply, the amount seems unusual for the category, or the description contradicts the bank-category — set "needsReview" to true and provide a short "reviewReason" explaining why.

Respond with ONLY a JSON array. Each object must have: "id" (number), "category" (string), "needsReview" (boolean). Include "reviewReason" (string) only when needsReview is true. No markdown, no explanation.`,
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
  const { transactions, categories } = await import('../db/schema.js');

  const catRows = db.select({ name: categories.name, rules: categories.rules }).from(categories).all();
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
      systemPrompt: `You are a transaction categorizer for an Israeli user's bank transactions. Assign each transaction one of these categories:

${formatCategoryList(catRows)}

If you are confident in the category, set "needsReview" to false.
If the transaction is ambiguous — the description is vague, multiple categories could apply, the amount seems unusual for the category, or the description contradicts the bank-category — set "needsReview" to true and provide a short "reviewReason" explaining why.

Respond with ONLY a JSON array. Each object must have: "id" (number), "category" (string), "needsReview" (boolean). Include "reviewReason" (string) only when needsReview is true. No markdown, no explanation.`,
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
