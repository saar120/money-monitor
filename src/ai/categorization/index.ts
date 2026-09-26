import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { config } from '../../config.js';
import { db } from '../../db/connection.js';
import { categories, transactions } from '../../db/schema.js';
import { applyOwnership } from '../../services/ownership.js';
import type { Transaction } from '../../shared/types.js';
import { categorizeWithLlm } from './llm.js';
import { categorizeWithTypeSafe } from './typesafe.js';
import type { CategorizationCategory, CategorizationPrediction } from './types.js';

function getCategories(): CategorizationCategory[] {
  return db
    .select({
      name: categories.name,
      label: categories.label,
      rules: categories.rules,
      ignoredFromStats: categories.ignoredFromStats,
    })
    .from(categories)
    .all();
}

function validatePredictions(
  predictions: CategorizationPrediction[],
  sourceTransactions: Transaction[],
  categoryRows: CategorizationCategory[],
) {
  const validIds = new Set(sourceTransactions.map((transaction) => transaction.id));
  const validCategories = new Set(categoryRows.map((category) => category.name));
  for (const prediction of predictions) {
    if (!validIds.has(prediction.id))
      throw new Error(`Categorizer returned an invalid transaction ID: ${prediction.id}`);
    if (!validCategories.has(prediction.category))
      throw new Error(`Categorizer returned an invalid category: ${prediction.category}`);
    if (
      prediction.confidence !== undefined &&
      (prediction.confidence < 0 || prediction.confidence > 1)
    ) {
      throw new Error(`Categorizer returned invalid confidence for transaction ${prediction.id}`);
    }
  }
}

async function categorizeBatch(
  sourceTransactions: Transaction[],
): Promise<{ categorized: number }> {
  if (sourceTransactions.length === 0) return { categorized: 0 };
  const categoryRows = getCategories();
  if (categoryRows.length === 0) return { categorized: 0 };

  const adapter =
    config.CATEGORIZATION_PROVIDER === 'typesafe' ? categorizeWithTypeSafe : categorizeWithLlm;
  const predictions = await adapter({ transactions: sourceTransactions, categories: categoryRows });
  validatePredictions(predictions, sourceTransactions, categoryRows);

  const ignoredCategories = new Set(
    categoryRows.filter((category) => category.ignoredFromStats).map((category) => category.name),
  );
  db.transaction((tx) => {
    for (const { id, category, confidence, reviewReason } of predictions) {
      const needsReview = confidence !== undefined && confidence < 0.8;
      tx.update(transactions)
        .set({
          category,
          confidence: confidence ?? null,
          needsReview,
          reviewReason: needsReview ? (reviewReason ?? 'Low confidence categorization') : null,
          ignored: ignoredCategories.has(category),
        })
        .where(eq(transactions.id, id))
        .run();
    }
  });
  if (predictions.length > 0) {
    applyOwnership({ ids: sourceTransactions.map(({ id }) => id) });
  }
  return { categorized: predictions.length };
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
  const sourceTransactions =
    conditions.length > 0
      ? db
          .select()
          .from(transactions)
          .where(and(...conditions))
          .all()
      : db.select().from(transactions).all();
  return categorizeBatch(sourceTransactions);
}

export type {
  CategorizationAdapter,
  CategorizationCategory,
  CategorizationInput,
  CategorizationPrediction,
} from './types.js';
