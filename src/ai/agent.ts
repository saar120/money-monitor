import { query } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config.js';
import { buildFinancialAdvisorPrompt } from './prompts.js';
import { buildFinancialMcpServer } from './tools.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

async function getCategoryNames(): Promise<string[]> {
  const { db } = await import('../db/connection.js');
  const { categories } = await import('../db/schema.js');
  const rows = db.select({ name: categories.name }).from(categories).all();
  return rows.map(r => r.name);
}

export async function chat(conversationHistory: ChatMessage[]): Promise<string> {
  const categoryNames = await getCategoryNames();
  const systemPrompt = buildFinancialAdvisorPrompt(categoryNames);
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

  const categoryRows = db.select({ name: categories.name }).from(categories).all();
  const categoryNames = categoryRows.map(r => r.name);
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

  const txnList = uncategorized.map(t => {
    const meta = t.meta ? JSON.parse(t.meta) : {};
    const bankCat = meta.bankCategory ? ` | bank-category: ${meta.bankCategory}` : '';
    return `ID:${t.id} | ${t.date} | ₪${t.chargedAmount} | ${t.description}${bankCat}`;
  }).join('\n');

  const categoryList = categoryNames.join(', ');

  let text = '';
  for await (const msg of query({
    prompt: `Categorize these transactions:\n${txnList}`,
    options: {
      model: config.ANTHROPIC_MODEL,
      systemPrompt: `You are a transaction categorizer. Assign each transaction one of these categories: ${categoryList}. Respond with ONLY a JSON array of objects with "id" and "category" fields. No markdown, no explanation.`,
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
    const clean = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    const results: Array<{ id: number; category: string }> = JSON.parse(clean);
    for (const { id, category } of results) {
      if (!validIds.has(id)) continue;
      if (!validCategories.has(category)) continue;
      db.update(transactions)
        .set({ category })
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

  const categoryRows = db.select({ name: categories.name }).from(categories).all();
  const categoryNames = categoryRows.map(r => r.name);
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

  const txnList = toProcess.map(t => {
    const meta = t.meta ? JSON.parse(t.meta) : {};
    const bankCat = meta.bankCategory ? ` | bank-category: ${meta.bankCategory}` : '';
    return `ID:${t.id} | ${t.date} | ₪${t.chargedAmount} | ${t.description}${bankCat}`;
  }).join('\n');

  const categoryList = categoryNames.join(', ');

  let text = '';
  for await (const msg of query({
    prompt: `Categorize these transactions:\n${txnList}`,
    options: {
      model: config.ANTHROPIC_MODEL,
      systemPrompt: `You are a transaction categorizer. Assign each transaction one of these categories: ${categoryList}. Respond with ONLY a JSON array of objects with "id" and "category" fields. No markdown, no explanation.`,
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
    const clean = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    const results: Array<{ id: number; category: string }> = JSON.parse(clean);
    for (const { id, category } of results) {
      if (!validIds.has(id)) continue;
      if (!validCategories.has(category)) continue;
      db.update(transactions)
        .set({ category })
        .where(eq(transactions.id, id))
        .run();
      categorized++;
    }
  } catch {
    // malformed model response — return 0
  }

  return { categorized };
}
