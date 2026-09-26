import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { evaluateTypeSafe, type TypeSafeQuestion } from '../ai/typesafe/client.js';
import { config } from '../config.js';
import * as schema from '../db/schema.js';

export type RecurringFrequency = 'monthly' | 'everyTwoMonths';

export interface RecurringPayment {
  accountId: number;
  merchantKey: string;
  name: string;
  accountName: string;
  currencyCode: string;
  usualAmount: number;
  monthlyCost: number;
  annualCost: number;
  frequency: RecurringFrequency;
  occurrences: number;
  lastChargeDate: string;
  nextExpectedDate: string;
  confidence: 'likely' | 'possible';
  kind: 'subscription' | 'serviceBill';
  source: 'automatic' | 'manual' | 'suggestion' | 'excluded';
}

export interface RecurringPaymentsResult {
  payments: RecurringPayment[];
  suggestions: RecurringPayment[];
  excluded: RecurringPayment[];
  totals: Array<{ currencyCode: string; monthlyCost: number; annualCost: number }>;
  asOfDate: string;
  classificationPending: boolean;
}

export interface RecurringTransaction {
  id?: number;
  accountId: number;
  accountName: string;
  date: string;
  description: string;
  amount: number;
  currencyCode: string;
  category?: string | null;
  type?: string;
  installmentTotal: number | null;
}

export interface RecurringPaymentDetail {
  payment: RecurringPayment;
  previousAmount: number | null;
  changedOnDate: string | null;
  transactions: Array<{
    id: number;
    date: string;
    description: string;
    amount: number;
    inPattern: boolean;
  }>;
}

const DAY = 86_400_000;
const round = (value: number) => Math.round(value * 100) / 100;
const CLASSIFICATION_BATCH = 10;
const CLASSIFICATION_WAIT_MS = 4_000;
const classificationCriteria = {
  subscription: 'Ongoing paid access to a product, app, media service, club, or membership.',
  serviceBill: 'A recurring bill for utilities, insurance, telecom, or an ongoing service.',
  ordinary:
    'Repeat visits or purchases at a shop, cafe, restaurant, or other pay-per-visit merchant.',
  other:
    'Transfer, loan repayment, rent, tax, or another regular payment outside subscriptions and services.',
  unknown: 'The merchant description does not reveal what the recurring charge is for.',
};
type Classification = keyof typeof classificationCriteria;
type Judgment = { choice: Classification; probability: number };
const classificationCache = new Map<string, Judgment>();
const classificationInFlight = new Map<string, Promise<void>>();
let classificationRetryAfter = 0;
let failedApiKey = '';
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return first.toISOString().slice(0, 10);
}

function merchantName(description: string): string {
  return description
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .replace(/\d{2}\/\d{2}(?:\/\d{2,4})?/gu, '')
    .replace(/\s*#?\d{5,}$/gu, '')
    .trim();
}

function merchantKey(name: string): string {
  // The stable review ID must not reveal unmasked bank description text to mobile clients.
  return createHash('sha256').update(name.toLocaleLowerCase()).digest('hex');
}

export interface RecurringPaymentDecision {
  accountId: number;
  currencyCode: string;
  merchantKey: string;
  decision: 'include' | 'exclude';
}

function paymentId(payment: RecurringPayment): string {
  return `${payment.accountId}\0${payment.currencyCode}\0${payment.merchantKey}`;
}

export function saveRecurringPaymentDecision(
  db: BetterSQLite3Database<typeof schema>,
  input: Omit<RecurringPaymentDecision, 'decision'> & { decision: 'include' | 'exclude' | 'auto' },
): void {
  const identity = and(
    eq(schema.recurringPaymentDecisions.accountId, input.accountId),
    eq(schema.recurringPaymentDecisions.currencyCode, input.currencyCode),
    eq(schema.recurringPaymentDecisions.merchantKey, input.merchantKey),
  );
  if (input.decision === 'auto') {
    db.delete(schema.recurringPaymentDecisions).where(identity).run();
  } else {
    db.insert(schema.recurringPaymentDecisions)
      .values({ ...input, decision: input.decision })
      .onConflictDoUpdate({
        target: [
          schema.recurringPaymentDecisions.accountId,
          schema.recurringPaymentDecisions.currencyCode,
          schema.recurringPaymentDecisions.merchantKey,
        ],
        set: { decision: input.decision },
      })
      .run();
  }
}

type PatternMatch = {
  entries: RecurringTransaction[];
  frequency: RecurringFrequency;
  next: string;
  monthlyFactor: number;
};

function amountProfile(entries: readonly RecurringTransaction[]) {
  const amounts = entries.map((row) => Math.abs(row.amount));
  const average = amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length;
  const smallest = Math.min(...amounts);
  const largest = Math.max(...amounts);
  const stable = (values: number[]) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.max(...values) - Math.min(...values) <= mean * 0.15;
  };
  for (let split = 2; split < amounts.length; split++) {
    const before = amounts.slice(0, split);
    const after = amounts.slice(split);
    if (!stable(before) || !stable(after)) continue;
    const previous = before.reduce((sum, value) => sum + value, 0) / before.length;
    const current = after.reduce((sum, value) => sum + value, 0) / after.length;
    if (Math.abs(current - previous) <= previous * 0.15) continue;
    if (after.length < 2 && current <= previous * 2 && previous <= current * 2) continue;
    return {
      usualAmount: round(current),
      previousAmount: round(previous),
      changedOnDate: entries[split].date,
    };
  }
  if (stable(amounts) || (entries.length >= 3 && largest <= smallest * 2)) {
    return { usualAmount: round(average), previousAmount: null, changedOnDate: null };
  }
  return null;
}

function bestPattern(group: RecurringTransaction[], asOfDate: string): PatternMatch | null {
  const patterns: Array<{
    frequency: RecurringFrequency;
    monthlyFactor: number;
    tolerance: number;
    advance: (date: string, cycles: number) => string;
  }> = [
    ...(
      [
        [1, 'monthly'],
        [2, 'everyTwoMonths'],
      ] as const
    ).map(([months, frequency]) => ({
      frequency,
      monthlyFactor: 1 / months,
      tolerance: 5,
      advance: (date: string, cycles: number) => addMonths(date, months * cycles),
    })),
  ];
  let best: PatternMatch | null = null;
  for (const pattern of patterns) {
    for (let start = 0; start < group.length - 1; start++) {
      const entries = [group[start]];
      let scan = start + 1;
      let skippedCycle = false;
      while (scan < group.length) {
        const last = entries.at(-1)!.date;
        const findMatch = (cycles: number) => {
          const expected = pattern.advance(last, cycles);
          const following = pattern.advance(expected, 1);
          const followingCharges = group.filter(
            (row) => Math.abs(daysBetween(following, row.date)) <= pattern.tolerance,
          );
          const averageAmount =
            entries.reduce((sum, row) => sum + Math.abs(row.amount), 0) / entries.length;
          let match = -1;
          let bestScore = Infinity;
          let bestAmountDifference = Infinity;
          for (let index = scan; index < group.length; index++) {
            const dayDifference = Math.abs(daysBetween(expected, group[index].date));
            if (dayDifference > pattern.tolerance) continue;
            // Prefer the regular charge when a merchant also makes an extra sale nearby.
            const amountDifference =
              Math.abs(Math.abs(group[index].amount) - averageAmount) / averageAmount;
            const nextAmountDifference = followingCharges.length
              ? Math.min(
                  ...followingCharges.map(
                    (row) =>
                      Math.abs(Math.abs(group[index].amount) - Math.abs(row.amount)) /
                      Math.abs(row.amount),
                  ),
                )
              : 0;
            const score = followingCharges.length
              ? dayDifference + Math.min(amountDifference, nextAmountDifference) * 10
              : dayDifference * 3 + amountDifference;
            if (
              score < bestScore ||
              (score === bestScore && amountDifference < bestAmountDifference)
            ) {
              match = index;
              bestScore = score;
              bestAmountDifference = amountDifference;
            }
          }
          return match;
        };
        let match = findMatch(1);
        if (match < 0 && entries.length >= 2 && !skippedCycle) {
          match = findMatch(2);
          if (match >= 0) skippedCycle = true;
        }
        if (match < 0) break;
        entries.push(group[match]);
        scan = match + 1;
      }
      if (entries.length < 2) continue;
      const last = entries.at(-1)!.date;
      if (
        best &&
        (best.entries.length > entries.length ||
          (best.entries.length === entries.length && best.entries.at(-1)!.date >= last))
      )
        continue;
      let cycles = 1;
      const anchor = entries[0].date;
      let next = pattern.advance(anchor, cycles);
      while (next <= last) next = pattern.advance(anchor, ++cycles);
      if (Math.abs(daysBetween(pattern.advance(anchor, cycles - 1), last)) > pattern.tolerance) {
        next = pattern.advance(last, 1);
      }
      if (daysBetween(next, asOfDate) > 7) continue;
      best = {
        entries,
        frequency: pattern.frequency,
        next,
        monthlyFactor: pattern.monthlyFactor,
      };
    }
  }
  return best;
}

/** Detect repeat charges from bank dates. The result is an estimate, never a billing schedule. */
export function discoverRecurringPayments(
  rows: readonly RecurringTransaction[],
  asOfDate: string,
  decisions: readonly RecurringPaymentDecision[] = [],
  judgments: ReadonlyMap<string, Judgment> = new Map(),
): RecurringPaymentsResult {
  const decisionByKey = new Map(
    decisions.map((item) => [
      `${item.accountId}\0${item.currencyCode}\0${item.merchantKey}`,
      item.decision,
    ]),
  );
  const groups = new Map<string, RecurringTransaction[]>();
  for (const row of rows) {
    if (row.amount >= 0 || (row.installmentTotal ?? 0) > 1 || row.type === 'transfer') continue;
    const name = merchantName(row.description);
    if (!name) continue;
    const currencyCode = row.currencyCode === '₪' ? 'ILS' : row.currencyCode;
    const key = `${row.accountId}\0${currencyCode}\0${merchantKey(name)}`;
    const group = groups.get(key) ?? [];
    group.push({ ...row, currencyCode });
    groups.set(key, group);
  }

  const payments: RecurringPayment[] = [];
  const suggestions: RecurringPayment[] = [];
  const excluded: RecurringPayment[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.date.localeCompare(b.date));
    const pattern = bestPattern(group, asOfDate);
    if (!pattern) continue;
    const entries = pattern.entries;
    const decision = decisionByKey.get(key);
    const judgment = judgments.get(key);
    const service = judgment?.choice === 'subscription' || judgment?.choice === 'serviceBill';
    const automatic = service && judgment.probability >= 0.9 && entries.length >= 3;
    const ordinary =
      (judgment?.choice === 'ordinary' || judgment?.choice === 'other') &&
      judgment.probability >= 0.8;
    if (ordinary && !decision) continue;
    const dates = entries.map((row) => row.date);

    const profile = amountProfile(entries);
    if (!profile) continue;

    const usualAmount = profile.usualAmount;
    const monthlyCost = round(usualAmount * pattern.monthlyFactor);
    const payment: RecurringPayment = {
      accountId: entries[0].accountId,
      merchantKey: key.split('\0')[2],
      name: merchantName(entries.at(-1)!.description),
      accountName: entries.at(-1)!.accountName,
      currencyCode: entries.at(-1)!.currencyCode,
      usualAmount,
      monthlyCost,
      annualCost: round(usualAmount * pattern.monthlyFactor * 12),
      frequency: pattern.frequency,
      occurrences: entries.length,
      lastChargeDate: dates.at(-1)!,
      nextExpectedDate: pattern.next,
      confidence: entries.length >= 3 ? 'likely' : 'possible',
      kind: judgment?.choice === 'subscription' ? 'subscription' : 'serviceBill',
      source:
        decision === 'include'
          ? 'manual'
          : decision === 'exclude'
            ? 'excluded'
            : automatic
              ? 'automatic'
              : 'suggestion',
    };
    if (decision === 'exclude') excluded.push(payment);
    else if (decision === 'include' || automatic) payments.push(payment);
    else suggestions.push(payment);
  }

  for (const list of [payments, suggestions, excluded]) {
    list.sort((a, b) => b.monthlyCost - a.monthlyCost || a.name.localeCompare(b.name));
  }
  const byCurrency = new Map<string, { monthlyCost: number; annualCost: number }>();
  for (const payment of payments) {
    const total = byCurrency.get(payment.currencyCode) ?? { monthlyCost: 0, annualCost: 0 };
    total.monthlyCost += payment.monthlyCost;
    total.annualCost += payment.annualCost;
    byCurrency.set(payment.currencyCode, total);
  }
  return {
    payments,
    suggestions,
    excluded,
    totals: [...byCurrency]
      .map(([currencyCode, total]) => ({
        currencyCode,
        monthlyCost: round(total.monthlyCost),
        annualCost: round(total.annualCost),
      }))
      .sort((a, b) => a.currencyCode.localeCompare(b.currencyCode)),
    asOfDate,
    classificationPending: false,
  };
}

async function classifyRecurringPayments(
  rows: readonly RecurringTransaction[],
  asOfDate: string,
  decisions: readonly RecurringPaymentDecision[],
): Promise<RecurringPaymentsResult> {
  const initial = discoverRecurringPayments(rows, asOfDate, decisions);
  const apiKey = config.TYPESAFE_API_KEY;
  if (!apiKey || initial.suggestions.length === 0) return initial;

  const judgments = new Map<string, Judgment>();
  const pending = initial.suggestions.filter((payment) => {
    const cached = classificationCache.get(classificationCacheKey(payment));
    if (cached) judgments.set(paymentId(payment), cached);
    return !cached;
  });
  if (apiKey === failedApiKey && Date.now() < classificationRetryAfter) {
    return discoverRecurringPayments(rows, asOfDate, decisions, judgments);
  }

  for (let offset = 0; offset < pending.length; offset += CLASSIFICATION_BATCH) {
    const batchApiKey = config.TYPESAFE_API_KEY;
    if (!batchApiKey || (batchApiKey === failedApiKey && Date.now() < classificationRetryAfter))
      break;
    const batch = pending.slice(offset, offset + CLASSIFICATION_BATCH);
    const batchKey = `${createHash('sha256').update(batchApiKey).digest('hex')}|${batch.map(classificationCacheKey).join('|')}`;
    let work = classificationInFlight.get(batchKey);
    if (!work) {
      work = evaluateClassificationBatch(batch).finally(() =>
        classificationInFlight.delete(batchKey),
      );
      classificationInFlight.set(batchKey, work);
    }
    try {
      await work;
    } catch (error) {
      if (config.TYPESAFE_API_KEY === batchApiKey) {
        failedApiKey = batchApiKey;
        classificationRetryAfter = Date.now() + 60_000;
      }
      console.warn(
        'Subscription classification unavailable:',
        error instanceof Error ? error.message : error,
      );
      break;
    }
    for (const payment of batch) {
      const judgment = classificationCache.get(classificationCacheKey(payment));
      if (judgment) judgments.set(paymentId(payment), judgment);
    }
  }
  return discoverRecurringPayments(rows, asOfDate, decisions, judgments);
}

async function evaluateClassificationBatch(batch: readonly RecurringPayment[]): Promise<void> {
  const questions: Record<string, TypeSafeQuestion> = {};
  batch.forEach((_, index) => {
    questions[`candidate_${index}`] = {
      type: 'choice',
      instructions: {
        question: `What kind of merchant is \`candidates[${index}]\` most likely to represent?`,
        guidance:
          'The dates already repeat. Judge the merchant and payment purpose, not recurrence alone. Treat an unclear description as unknown.',
      },
      criteria: classificationCriteria,
    };
  });
  const response = await evaluateTypeSafe({
    state: {
      candidates: batch.map((payment) => ({
        name: payment.name,
        frequency: payment.frequency,
        usual_amount: payment.usualAmount,
        currency: payment.currencyCode,
      })),
    },
    questions,
  });
  batch.forEach((payment, index) => {
    const answer = response.answers[`candidate_${index}`];
    if (answer?.type !== 'choice' || !(answer.choice in classificationCriteria)) return;
    classificationCache.set(classificationCacheKey(payment), {
      choice: answer.choice as Classification,
      probability: answer.probabilities[answer.choice] ?? 0,
    });
  });
}

function classificationCacheKey(payment: RecurringPayment): string {
  return `${paymentId(payment)}\0${payment.occurrences}\0${payment.lastChargeDate}\0${payment.usualAmount}`;
}

export async function readRecurringPayments(
  db: BetterSQLite3Database<typeof schema>,
  asOfDate: string,
): Promise<RecurringPaymentsResult> {
  const rows = loadRecurringRows(db, asOfDate);
  const decisions = db.select().from(schema.recurringPaymentDecisions).all();
  const initial = discoverRecurringPayments(rows, asOfDate, decisions);
  if (!config.TYPESAFE_API_KEY || initial.suggestions.length === 0) return initial;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      classifyRecurringPayments(rows, asOfDate, decisions),
      new Promise<RecurringPaymentsResult>((resolve) => {
        timeout = setTimeout(
          () => resolve({ ...initial, classificationPending: true }),
          CLASSIFICATION_WAIT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function loadRecurringRows(
  db: BetterSQLite3Database<typeof schema>,
  asOfDate: string,
  accountId?: number,
) {
  const startDate = addMonths(asOfDate, -24);
  return db
    .select({
      id: schema.transactions.id,
      accountId: schema.transactions.accountId,
      accountName: schema.accounts.displayName,
      date: schema.transactions.date,
      description: schema.transactions.description,
      amount: schema.transactions.chargedAmount,
      currencyCode: schema.transactions.chargedCurrency,
      type: schema.transactions.type,
      installmentTotal: schema.transactions.installmentTotal,
    })
    .from(schema.transactions)
    .innerJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
    .where(
      and(
        gte(schema.transactions.date, startDate),
        lt(schema.transactions.chargedAmount, 0),
        eq(schema.transactions.ignored, false),
        eq(schema.transactions.status, 'completed'),
        sql`${schema.transactions.date} <= ${asOfDate}`,
        accountId === undefined ? undefined : eq(schema.transactions.accountId, accountId),
      ),
    )
    .all();
}

export function readRecurringPaymentDetail(
  db: BetterSQLite3Database<typeof schema>,
  asOfDate: string,
  identity: Pick<RecurringPayment, 'accountId' | 'currencyCode' | 'merchantKey'>,
): RecurringPaymentDetail | null {
  const rows = loadRecurringRows(db, asOfDate, identity.accountId).filter(
    (row) =>
      (row.currencyCode === '₪' ? 'ILS' : row.currencyCode) === identity.currencyCode &&
      merchantKey(merchantName(row.description)) === identity.merchantKey,
  );
  const eligible = rows
    .filter((row) => (row.installmentTotal ?? 0) <= 1 && row.type !== 'transfer')
    .sort((a, b) => a.date.localeCompare(b.date));
  const pattern = bestPattern(eligible, asOfDate);
  if (!pattern) return null;
  const decisions = db.select().from(schema.recurringPaymentDecisions).all();
  const result = discoverRecurringPayments(eligible, asOfDate, decisions);
  const payment = [...result.payments, ...result.suggestions, ...result.excluded][0];
  const profile = amountProfile(pattern.entries);
  if (!payment || !profile) return null;
  const matchedIds = new Set(pattern.entries.map((entry) => entry.id));
  return {
    payment,
    previousAmount: profile.previousAmount,
    changedOnDate: profile.changedOnDate,
    transactions: rows
      .map((row) => ({
        id: row.id,
        date: row.date,
        description: row.description,
        amount: round(Math.abs(row.amount)),
        inPattern: matchedIds.has(row.id),
      }))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id),
  };
}
