import { parseMeta } from '../../shared/types.js';
import { evaluateTypeSafe, type TypeSafeQuestion } from '../typesafe/client.js';
import type { CategorizationAdapter, CategorizationPrediction } from './types.js';

const CHUNK_SIZE = 10;
const instructions = [
  'Choose the best spending category for the referenced transaction.',
  'Use an explicit purpose in the memo or description when available.',
  'Then use merchant identity and the supplied category descriptions.',
  'Treat the bank-provided category as a weak hint.',
  'BIT, PayBox, mobile transfer, bank transfer, and cheque describe payment methods rather than spending categories.',
  "A recognizable merchant refund retains the merchant's expense category; a positive amount alone does not imply income.",
  'Choose `other` when the available evidence is insufficient instead of forcing a specific category.',
];

function transactionEvidence(
  transaction: Parameters<CategorizationAdapter>[0]['transactions'][number],
) {
  const bankCategory = parseMeta(transaction.meta).bankCategory;
  return {
    id: transaction.id,
    date: transaction.date,
    original_amount: transaction.originalAmount,
    charged_amount: transaction.chargedAmount,
    original_currency: transaction.originalCurrency,
    charged_currency: transaction.chargedCurrency,
    description: transaction.description,
    ...(transaction.memo ? { memo: transaction.memo } : {}),
    transaction_type: transaction.type,
    status: transaction.status,
    ...(bankCategory ? { bank_category: bankCategory } : {}),
    ...(transaction.installmentNumber != null
      ? { installment_number: transaction.installmentNumber }
      : {}),
    ...(transaction.installmentTotal != null
      ? { installment_total: transaction.installmentTotal }
      : {}),
    amount_direction:
      transaction.chargedAmount < 0
        ? 'outflow'
        : transaction.chargedAmount > 0
          ? 'inflow_or_refund'
          : 'zero',
  };
}

export const categorizeWithTypeSafe: CategorizationAdapter = async ({
  transactions,
  categories,
}) => {
  const criteria = Object.fromEntries(
    categories.map((category) => [
      category.name,
      category.rules?.trim()
        ? { label: category.label, description: category.rules.trim() }
        : category.label,
    ]),
  );
  const validIds = new Set(transactions.map((transaction) => transaction.id));
  const validCategories = new Set(categories.map((category) => category.name));
  const chunks = Array.from({ length: Math.ceil(transactions.length / CHUNK_SIZE) }, (_, index) =>
    transactions.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE),
  );

  const chunkPredictions = await Promise.all(
    chunks.map(async (chunk) => {
      const questions: Record<string, TypeSafeQuestion> = {};
      chunk.forEach((transaction, index) => {
        questions[`transaction_${transaction.id}`] = {
          type: 'choice',
          instructions: {
            decision_rules: instructions,
            question: `Which category best matches \`transactions[${index}]\`?`,
          },
          criteria,
        };
      });
      const response = await evaluateTypeSafe({
        state: { transactions: chunk.map(transactionEvidence) },
        questions,
      });
      const expectedAnswerIds = new Set(Object.keys(questions));
      for (const answerId of Object.keys(response.answers)) {
        if (!expectedAnswerIds.has(answerId)) {
          throw new Error(`TypeSafe returned an invalid transaction answer: ${answerId}`);
        }
      }
      return chunk.map((transaction) => {
        const answer = response.answers[`transaction_${transaction.id}`];
        if (!answer || answer.type !== 'choice')
          throw new Error(`TypeSafe response is missing transaction ${transaction.id}`);
        return { id: transaction.id, category: answer.choice, confidence: answer.confidence };
      });
    }),
  );

  const predictions: CategorizationPrediction[] = chunkPredictions.flat();
  for (const prediction of predictions) {
    if (!validIds.has(prediction.id))
      throw new Error(`TypeSafe returned an invalid transaction ID: ${prediction.id}`);
    if (!validCategories.has(prediction.category))
      throw new Error(`TypeSafe returned an invalid category: ${prediction.category}`);
  }
  return predictions;
};
