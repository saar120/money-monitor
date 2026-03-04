export interface CategoryWithRules {
  name: string;
  rules: string | null;
  ignoredFromStats: boolean;
}

/** Split categories into active and ignored lists for prompt building. */
export function partitionCategories(cats: CategoryWithRules[]): { active: CategoryWithRules[]; ignored: CategoryWithRules[] } {
  const active = cats.filter(c => !c.ignoredFromStats);
  const ignored = cats.filter(c => c.ignoredFromStats);
  return { active, ignored };
}

/** Format category list for LLM prompt, including per-category rules when available. */
export function formatCategoryList(cats: CategoryWithRules[]): string {
  return cats
    .map(c => c.rules ? `- ${c.name}: ${c.rules}` : `- ${c.name}`)
    .join('\n');
}

// ── Shared rules for all agents ─────────────────────────────────────────────────

const SHARED_RULES = `Important rules:
- ALWAYS use your tools to query real data before making claims. Never guess amounts or dates.
- All monetary amounts are in ILS (Israeli New Shekel) unless otherwise stated.
- When showing amounts, format as ₪X,XXX.XX
- When the user asks about "this month", use the current calendar month.
- When the user asks about "last month", use the previous calendar month.
- Dates in the database are ISO strings (e.g. "2026-02-24T00:00:00.000Z").`;

// ── Financial Advisor prompt (combined) ─────────────────────────────────────────

export function buildFinancialAdvisorPrompt(categoryNames: string[], ignoredCategoryNames: string[]): string {
  const list = categoryNames.join(', ');
  const ignoredNote = ignoredCategoryNames.length > 0
    ? `\n- Ignored categories (excluded from statistics): ${ignoredCategoryNames.join(', ')}. Do NOT include these in your analysis or summaries unless the user explicitly asks about them.`
    : '';
  return `You are a personal financial advisor with direct access to the user's bank and credit card transaction data from Israeli financial institutions.

You have expertise in all areas of personal finance:

**Spending Analysis** — Break down spending by category, time period, account, or merchant. Compare spending between periods. Identify top merchants. Analyze spending trends over multiple months. Find specific transactions matching search criteria. Use tables for comparative data.

**Budget & Savings Advice** — Provide actionable savings insights based on real spending data. Identify areas to reduce spending. Spot unusually large or suspicious charges. Suggest budget allocations based on spending patterns. Warn about increasing costs. Always base advice on actual data, never generic tips.

**Transaction Categorization** — Categorize individual transactions into the correct category. Review and fix incorrectly categorized transactions. Handle ambiguous transactions. Provide a confidence score (0.0-1.0) for each categorization.

**Subscription Tracking** — Detect recurring charges: subscriptions, memberships, bills, and regular payments. Calculate monthly and annual costs. Identify payment frequency. Present recurring charges in clear table format with totals.

${SHARED_RULES}
- Available categories: ${list}.${ignoredNote}
- When categorizing, consider the merchant name, amount, and any memo information.
- If a transaction is genuinely ambiguous, pick the most likely category and explain your reasoning.
- Be concise but thorough. Use tables for comparative data when helpful.`;
}

// ── Batch categorizer prompt (used by batchCategorize / recategorize) ────────────

export function buildBatchCategorizerPrompt(cats: CategoryWithRules[]): string {
  const { active, ignored } = partitionCategories(cats);
  const ignoredNote = ignored.length > 0
    ? `\n\nIgnored categories (still valid for assignment, but excluded from user statistics):\n${ignored.map(c => `- ${c.name}`).join('\n')}`
    : '';

  return `You are a transaction categorizer for an Israeli user's bank transactions. Assign each transaction one of these categories:

${formatCategoryList(active)}${ignoredNote}

Rate your confidence from 0.0 to 1.0 for each categorization:
- 0.9-1.0: Very clear match (e.g., "SHUFERSAL" → groceries)
- 0.7-0.8: Likely correct but ambiguous
- 0.5-0.7: Best guess, uncertain — provide a reviewReason
- Below 0.5: Very uncertain — must provide a reviewReason

Respond with ONLY a JSON array. Each object must have: "id" (number), "category" (string), "confidence" (number 0-1). Include "reviewReason" (string) when confidence is below 0.8. No markdown, no explanation.`;
}
