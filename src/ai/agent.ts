import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { buildFinancialAdvisorPrompt } from './prompts.js';
import { buildTools, handleToolCall } from './tools.js';

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

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
  const tools = buildTools(categoryNames);

  const messages: Anthropic.MessageParam[] = conversationHistory.map(msg => ({
    role: msg.role,
    content: msg.content,
  }));

  const MAX_TOOL_ROUNDS = 10;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.messages.create({
      model: config.ANTHROPIC_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages,
    });

    const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');
    const textBlocks = response.content.filter(block => block.type === 'text');

    if (toolUseBlocks.length === 0) {
      return textBlocks.map(b => b.type === 'text' ? b.text : '').join('\n');
    }

    messages.push({ role: 'assistant', content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      if (block.type === 'tool_use') {
        const result = await handleToolCall(block.name, block.input as Record<string, unknown>);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return 'I reached the maximum number of analysis steps. Please try a more specific question.';
}

export async function batchCategorize(
  batchSize: number = 50,
  ids?: number[],
): Promise<{ categorized: number }> {
  const { eq, isNull } = await import('drizzle-orm');
  const { db } = await import('../db/connection.js');
  const { transactions, categories } = await import('../db/schema.js');

  // Fetch category names from DB
  const categoryRows = db.select({ name: categories.name }).from(categories).all();
  const categoryNames = categoryRows.map(r => r.name);
  if (categoryNames.length === 0) return { categorized: 0 };

  // Fetch uncategorized transactions — either specific IDs or next batch
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

  const txnList = uncategorized.map(t =>
    `ID:${t.id} | ${t.date} | ₪${t.chargedAmount} | ${t.description}`
  ).join('\n');

  const categoryList = categoryNames.join(', ');

  const response = await client.messages.create({
    model: config.ANTHROPIC_MODEL,
    max_tokens: 4096,
    system: `You are a transaction categorizer. Assign each transaction one of these categories: ${categoryList}. Respond with ONLY a JSON array of objects with "id" and "category" fields. No markdown, no explanation.`,
    messages: [{
      role: 'user',
      content: `Categorize these transactions:\n${txnList}`,
    }],
  });

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.type === 'text' ? b.text : '')
    .join('');

  let categorized = 0;
  try {
    const results: Array<{ id: number; category: string }> = JSON.parse(text);
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
