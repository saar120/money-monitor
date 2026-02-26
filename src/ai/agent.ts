import { query } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config.js';
import { buildAgentFinancialPrompt } from './prompts.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');
const DB_PATH = join(PROJECT_ROOT, 'data', 'money-monitor.db');

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

function buildSdkEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  if (config.CLAUDE_CODE_OAUTH_TOKEN) {
    env['CLAUDE_CODE_OAUTH_TOKEN'] = config.CLAUDE_CODE_OAUTH_TOKEN;
    delete env['ANTHROPIC_API_KEY'];
  }
  return env;
}

export async function chat(conversationHistory: ChatMessage[]): Promise<string> {
  const categoryNames = await getCategoryNames();
  const systemPrompt = buildAgentFinancialPrompt(categoryNames, DB_PATH);

  const historyLines = conversationHistory.slice(0, -1).map(m =>
    `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`
  );
  const lastMsg = conversationHistory[conversationHistory.length - 1];
  const prompt = historyLines.length > 0
    ? `Previous conversation:\n${historyLines.join('\n\n')}\n\nCurrent question: ${lastMsg.content}`
    : lastMsg.content;

  console.log(`[chat] starting query, messages=${conversationHistory.length}, auth=${config.CLAUDE_CODE_OAUTH_TOKEN ? 'oauth' : 'apiKey'}`);

  for await (const msg of query({
    prompt,
    options: {
      cwd: PROJECT_ROOT,
      model: config.ANTHROPIC_MODEL,
      systemPrompt,
      allowedTools: ['Bash'],
      env: buildSdkEnv(),
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    },
  })) {
    if (msg.type === 'result') {
      if (msg.subtype === 'success') {
        console.log(`[chat] success, turns=${msg.num_turns}, cost=$${msg.total_cost_usd?.toFixed(4)}`);
        return msg.result;
      } else {
        console.error(`[chat] agent error: subtype=${msg.subtype}`, msg.errors);
        throw new Error(`Agent error (${msg.subtype}): ${msg.errors?.join(', ') || 'unknown'}`);
      }
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

  const txnList = uncategorized.map(t =>
    `ID:${t.id} | ${t.date} | ₪${t.chargedAmount} | ${t.description}`
  ).join('\n');

  const categoryList = categoryNames.join(', ');

  let text = '';
  for await (const msg of query({
    prompt: `Categorize these transactions into one of: ${categoryList}\n\nTransactions:\n${txnList}\n\nRespond with ONLY a JSON array: [{"id":1,"category":"food"},...]`,
    options: {
      cwd: PROJECT_ROOT,
      model: config.ANTHROPIC_MODEL,
      systemPrompt: 'You are a transaction categorizer. Respond with ONLY a valid JSON array, no markdown, no explanation.',
      allowedTools: [],
      env: buildSdkEnv(),
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
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
      db.update(transactions).set({ category }).where(eq(transactions.id, id)).run();
      categorized++;
    }
  } catch {
    // If parsing fails, return 0
  }

  return { categorized };
}
