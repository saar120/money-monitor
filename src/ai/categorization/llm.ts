import { completeSimple } from '@earendil-works/pi-ai/compat';
import { getBatchModelSpec, getConfiguredBatchThinkingLevel } from '../../config.js';
import { parseMeta } from '../../shared/types.js';
import { buildBatchCategorizerPrompt } from '../prompts.js';
import { resolveApiKey } from '../auth.js';
import { resolveModel } from '../ai-utils.js';
import type { CategorizationAdapter, CategorizationPrediction } from './types.js';

function formatTransaction(
  t: Parameters<CategorizationAdapter>[0]['transactions'][number],
): string {
  const meta = parseMeta(t.meta);
  const bankCat = meta.bankCategory ? ` | bank-category: ${meta.bankCategory}` : '';
  const memo = t.memo ? ` | memo: ${t.memo}` : '';
  return `ID:${t.id} | ${t.date} | ₪${t.chargedAmount} | ${t.description}${memo}${bankCat}`;
}

function cleanJsonResponse(text: string): string {
  return text
    .replace(/^```(?:json)?\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim();
}

export const categorizeWithLlm: CategorizationAdapter = async ({ transactions, categories }) => {
  const validIds = new Set(transactions.map((transaction) => transaction.id));
  const validCategories = new Set(categories.map((category) => category.name));
  const { model, provider } = resolveModel(getBatchModelSpec());
  const reasoning = getConfiguredBatchThinkingLevel(model.reasoning);
  const apiKey = await resolveApiKey(provider);
  const response = await completeSimple(
    model,
    {
      systemPrompt: buildBatchCategorizerPrompt(categories),
      messages: [
        {
          role: 'user',
          content: `Categorize these transactions:\n${transactions.map(formatTransaction).join('\n')}`,
          timestamp: Date.now(),
        },
      ],
    },
    { ...(apiKey ? { apiKey } : {}), ...(reasoning ? { reasoning } : {}) },
  );
  const text = response.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('');

  try {
    const predictions = JSON.parse(cleanJsonResponse(text)) as CategorizationPrediction[];
    return predictions.filter(
      ({ id, category }) => validIds.has(id) && validCategories.has(category),
    );
  } catch (error) {
    console.error(
      '[AI] Failed to process categorization results:',
      error instanceof Error ? error.message : error,
    );
    return [];
  }
};
