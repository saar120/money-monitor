import { z } from 'zod';
import { config } from '../../config.js';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const RETRYABLE_STATUSES = new Set([429, 529]);
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type TypeSafeQuestion =
  | { type: 'choice'; instructions: JsonValue; criteria: Record<string, JsonValue> }
  | { type: 'noul'; instructions: JsonValue; criteria?: Record<string, JsonValue> }
  | { type: 'score'; instructions: JsonValue; criteria: JsonValue[] };

const probabilityMap = z.record(z.string(), z.number().min(0).max(1));
const answerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('choice'),
    choice: z.string(),
    probabilities: probabilityMap,
    confidence: z.number().min(0).max(1),
  }),
  z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) }),
  z.object({
    type: z.literal('score'),
    score: z.number(),
    legend: z.record(z.string(), z.string()),
    probabilities: probabilityMap,
    confidence: z.number().min(0).max(1),
  }),
]);

const responseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), answerSchema),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});

export type TypeSafeResponse = z.infer<typeof responseSchema>;

export async function evaluateTypeSafe(input: {
  state: JsonValue;
  questions: Record<string, TypeSafeQuestion>;
  model?: string;
}): Promise<TypeSafeResponse> {
  const apiKey = config.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error('TypeSafe API key is missing. Configure it in Settings.');

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: input.state,
          questions: input.questions,
          model: input.model ?? 'jev-latest',
        }),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error(`TypeSafe request timed out after ${DEFAULT_TIMEOUT_MS}ms`, {
          cause: error,
        });
      }
      throw new Error('TypeSafe request failed to connect', { cause: error });
    }

    if (response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error('TypeSafe returned an invalid JSON response');
      }
      const parsed = responseSchema.safeParse(payload);
      if (!parsed.success) throw new Error('TypeSafe returned an invalid response shape');
      return parsed.data;
    }

    if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS - 1) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
      const delayMs = Number.isFinite(retryAfter)
        ? Math.min(retryAfter * 1_000, 4_000)
        : 250 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    throw new Error(`TypeSafe request failed with status ${response.status}`);
  }

  throw new Error('TypeSafe request failed after retries');
}
