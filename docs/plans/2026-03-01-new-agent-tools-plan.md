# Implementation Plan: 4 New LLM Agent MCP Tools

## Date: 2026-03-01

---

## Overview

Add 4 new tools to the existing MCP server in `src/ai/tools.ts`. These tools use only existing data — no schema changes, no migrations, no new tables. The pattern is established: define a `tool()` in the `tools` array, implement a private query function below, return `JSON.stringify(...)`.

**Files to modify:**
- `src/ai/tools.ts` — add 4 tool definitions + 4 query functions
- `src/ai/prompts.ts` — update system prompt to mention new capabilities

**No changes to:** schema, migrations, routes, frontend, agent.ts, config, or any other file.

---

## Tool 1: `compare_periods`

### Purpose
Side-by-side spending comparison between two date ranges, broken down by category. Answers "How does this month compare to last month?" in a single tool call.

### Tool Definition

```ts
tool(
  'compare_periods',
  'Compare spending between two time periods. Returns a side-by-side breakdown by category showing totals, transaction counts, and percentage change. Use this when the user asks to compare months, weeks, or any two date ranges.',
  {
    period1_start: z.string().describe('Start date of first period (ISO string, e.g. "2026-01-01")'),
    period1_end: z.string().describe('End date of first period (ISO string, e.g. "2026-01-31")'),
    period2_start: z.string().describe('Start date of second period (ISO string, e.g. "2026-02-01")'),
    period2_end: z.string().describe('End date of second period (ISO string, e.g. "2026-02-28")'),
    account_id: z.number().optional().describe('Filter by account ID'),
  },
  async (args) => {
    const result = comparePeriods(args);
    return { content: [{ type: 'text' as const, text: result }] };
  },
)
```

### Query Function Logic

```
function comparePeriods(input): string
  1. Query spending grouped by category for period1 (SUM chargedAmount, COUNT)
     - WHERE date >= period1_start AND date <= period1_end AND ignored = false
     - Optional: AND account_id = input.account_id
     - GROUP BY COALESCE(category, 'uncategorized')

  2. Query spending grouped by category for period2 (same structure)

  3. Merge both into a unified result:
     - Collect all category names from both periods
     - For each category: { category, period1_total, period1_count, period2_total, period2_count, change_amount, change_percent }
     - change_amount = period2_total - period1_total
     - change_percent = period1_total != 0 ? ((period2_total - period1_total) / |period1_total|) * 100 : null

  4. Add summary row:
     - { overall_period1_total, overall_period2_total, overall_change_amount, overall_change_percent }

  5. Sort by absolute change_amount descending (biggest movers first)

  6. Return JSON.stringify({ comparison: [...], summary: {...} })
```

### Interface

```ts
interface ComparePeriodsInput {
  period1_start: string;
  period1_end: string;
  period2_start: string;
  period2_end: string;
  account_id?: number;
}
```

---

## Tool 2: `get_spending_trends`

### Purpose
Calculate spending trends over multiple months for a specific category or overall. Answers "Is my food spending going up?" with data and direction.

### Tool Definition

```ts
tool(
  'get_spending_trends',
  'Analyze spending trends over time. Returns monthly totals with trend direction (increasing/decreasing/stable), average, and month-over-month changes. Use this when the user asks about spending trends, whether costs are rising, or wants to see patterns over time.',
  {
    months: z.number().optional().describe('Number of months to analyze (default 6, max 24)'),
    category: z.string().optional().describe('Filter to a specific category (omit for overall spending)'),
    account_id: z.number().optional().describe('Filter by account ID'),
  },
  async (args) => {
    const result = getSpendingTrends(args);
    return { content: [{ type: 'text' as const, text: result }] };
  },
)
```

### Query Function Logic

```
function getSpendingTrends(input): string
  1. Determine date range:
     - months = min(input.months ?? 6, 24)
     - end_date = today
     - start_date = today minus `months` months (first day of that month)

  2. Query monthly spending:
     - SELECT strftime('%Y-%m', date) as month, SUM(charged_amount) as total, COUNT(*) as count
     - WHERE date >= start_date AND ignored = false
     - Optional: AND category = input.category
     - Optional: AND account_id = input.account_id
     - GROUP BY month
     - ORDER BY month ASC

  3. Compute analytics:
     - monthly_data: array of { month, total, count }
     - average = sum of totals / number of months with data
     - min_month = month with lowest total
     - max_month = month with highest total
     - month_over_month_changes: for each consecutive pair, compute { from, to, change_amount, change_percent }

  4. Determine trend direction using simple linear regression:
     - If slope > 5% of average → "increasing"
     - If slope < -5% of average → "decreasing"
     - Otherwise → "stable"
     - (Simple approach: compare average of first half vs second half of months)

  5. Return JSON.stringify({
       months: monthly_data,
       trend: "increasing" | "decreasing" | "stable",
       average,
       min: { month, total },
       max: { month, total },
       total_period: sum of all months,
       month_over_month: changes array
     })
```

### Interface

```ts
interface GetSpendingTrendsInput {
  months?: number;
  category?: string;
  account_id?: number;
}
```

---

## Tool 3: `detect_recurring_transactions`

### Purpose
Identify recurring charges (subscriptions, bills, memberships) by analyzing transaction history for repeated descriptions at regular intervals.

### Tool Definition

```ts
tool(
  'detect_recurring_transactions',
  'Detect recurring transactions such as subscriptions, memberships, and regular bills. Analyzes transaction history to find charges that repeat at regular intervals. Returns merchant name, amount, frequency, estimated annual cost, and last charge date.',
  {
    months_back: z.number().optional().describe('How many months of history to analyze (default 6, max 12)'),
    min_occurrences: z.number().optional().describe('Minimum times a charge must appear to be considered recurring (default 2)'),
  },
  async (args) => {
    const result = detectRecurringTransactions(args);
    return { content: [{ type: 'text' as const, text: result }] };
  },
)
```

### Query Function Logic

```
function detectRecurringTransactions(input): string
  1. Determine date range:
     - months_back = min(input.months_back ?? 6, 12)
     - start_date = today minus months_back months
     - min_occurrences = input.min_occurrences ?? 2

  2. Query all non-ignored completed transactions in range:
     - SELECT description, charged_amount, date
     - WHERE date >= start_date AND ignored = false AND status = 'completed'
     - ORDER BY description, date

  3. Normalize descriptions for grouping:
     - Trim whitespace
     - Remove trailing digits/dates/reference numbers (regex: strip trailing \d{4,} or date patterns)
     - Collapse multiple spaces
     - This is a best-effort normalization — done in JS, not SQL

  4. Group by normalized description:
     - For each group: collect all (date, amount) pairs
     - Filter: keep only groups with >= min_occurrences entries

  5. For each qualifying group, analyze pattern:
     - Sort dates ascending
     - Calculate intervals between consecutive charges (in days)
     - avg_interval = average of intervals
     - Determine frequency:
       - avg_interval <= 10 → "weekly"
       - avg_interval <= 20 → "bi-weekly"
       - avg_interval <= 45 → "monthly"
       - avg_interval <= 100 → "quarterly"
       - avg_interval <= 200 → "semi-annual"
       - else → "annual"
     - Check amount consistency:
       - If all amounts are within 10% of each other → "fixed"
       - Otherwise → "variable"
     - estimated_annual_cost:
       - avg_amount * (365 / avg_interval)
     - last_charge_date = most recent date
     - next_expected_date = last_charge_date + avg_interval

  6. Sort by estimated_annual_cost descending

  7. Return JSON.stringify({
       recurring: [
         {
           description (normalized),
           occurrences: count,
           avg_amount,
           frequency,
           amount_type: "fixed" | "variable",
           estimated_annual_cost,
           last_charge_date,
           next_expected_date,
           all_amounts: [list for variable ones]
         },
         ...
       ],
       total_recurring_monthly: sum of (estimated_annual_cost / 12) for all,
       total_recurring_annual: sum of estimated_annual_cost for all
     })
```

### Interface

```ts
interface DetectRecurringInput {
  months_back?: number;
  min_occurrences?: number;
}
```

### Description Normalization Helper

Create a private `normalizeDescription(desc: string): string` function:

```ts
function normalizeDescription(desc: string): string {
  return desc
    .trim()
    .replace(/\s+/g, ' ')                    // collapse whitespace
    .replace(/\d{2}\/\d{2}(\/\d{2,4})?/g, '') // remove date patterns like 01/02 or 01/02/26
    .replace(/\s*\d{5,}$/g, '')              // remove trailing long numbers (reference IDs)
    .replace(/\s*#\d+$/g, '')                // remove trailing #123 patterns
    .trim();
}
```

This is intentionally simple. Exact matching after normalization is good enough — the LLM can interpret edge cases when presenting results to the user.

---

## Tool 4: `get_top_merchants`

### Purpose
Rank merchants/payees by total spend, frequency, or average transaction size. Answers "Where do I spend the most?"

### Tool Definition

```ts
tool(
  'get_top_merchants',
  'Get top merchants/payees ranked by total spending, transaction frequency, or average transaction amount. Use this when the user asks where they spend the most, their most frequent charges, or top spending destinations.',
  {
    start_date: z.string().optional().describe('Start date (ISO string)'),
    end_date: z.string().optional().describe('End date (ISO string)'),
    sort_by: z.enum(['total', 'count', 'average']).optional().describe('Sort by total spending (default), transaction count, or average amount'),
    limit: z.number().optional().describe('Number of top merchants to return (default 15, max 50)'),
    category: z.string().optional().describe('Filter to a specific category'),
    account_id: z.number().optional().describe('Filter by account ID'),
  },
  async (args) => {
    const result = getTopMerchants(args);
    return { content: [{ type: 'text' as const, text: result }] };
  },
)
```

### Query Function Logic

```
function getTopMerchants(input): string
  1. Query all matching transactions:
     - SELECT description, charged_amount
     - WHERE ignored = false AND status = 'completed'
     - Optional: AND date >= start_date AND date <= end_date
     - Optional: AND category = input.category
     - Optional: AND account_id = input.account_id

  2. Normalize descriptions using normalizeDescription() (same helper as tool 3)

  3. Group by normalized description:
     - For each group: compute total_amount, count, avg_amount, min_amount, max_amount, last_date

  4. Sort by input.sort_by (default 'total'):
     - 'total' → sort by total_amount desc
     - 'count' → sort by count desc
     - 'average' → sort by avg_amount desc

  5. Take top N (limit = min(input.limit ?? 15, 50))

  6. Return JSON.stringify({
       top_merchants: [
         {
           merchant: normalized_description,
           total_amount,
           transaction_count,
           avg_amount,
           min_amount,
           max_amount,
           last_transaction_date,
           category (most common category in the group, if any)
         },
         ...
       ],
       total_merchants_found: total unique merchants before limit,
       period: { start_date, end_date } or "all time"
     })
```

### Interface

```ts
interface GetTopMerchantsInput {
  start_date?: string;
  end_date?: string;
  sort_by?: 'total' | 'count' | 'average';
  limit?: number;
  category?: string;
  account_id?: number;
}
```

---

## Shared: normalizeDescription helper

Both `detect_recurring_transactions` and `get_top_merchants` need description normalization. Define it once as a private function in `tools.ts`:

```ts
function normalizeDescription(desc: string): string {
  return desc
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\d{2}\/\d{2}(\/\d{2,4})?/g, '')
    .replace(/\s*\d{5,}$/g, '')
    .replace(/\s*#\d+$/g, '')
    .trim();
}
```

---

## System Prompt Update

In `src/ai/prompts.ts`, update `buildFinancialAdvisorPrompt` to mention the new capabilities. Add to the role section:

```
- Compare spending between any two time periods
- Detect recurring subscriptions and bills
- Identify top merchants by spending
- Analyze spending trends over multiple months
```

This ensures the LLM knows these tools exist and uses them proactively.

---

## Implementation Steps

### Step 1: Add `normalizeDescription` helper
- Location: `src/ai/tools.ts`, after the existing private functions (line ~196)
- No imports needed

### Step 2: Add `compare_periods` tool + query function
- Add `ComparePeriodsInput` interface alongside existing interfaces (~line 79)
- Add `comparePeriods()` function alongside existing functions (~line 170)
- Add `tool('compare_periods', ...)` to the tools array (~line 72)

### Step 3: Add `get_spending_trends` tool + query function
- Add `GetSpendingTrendsInput` interface
- Add `getSpendingTrends()` function
- Add `tool('get_spending_trends', ...)` to the tools array

### Step 4: Add `detect_recurring_transactions` tool + query function
- Add `DetectRecurringInput` interface
- Add `detectRecurringTransactions()` function
- Add `tool('detect_recurring_transactions', ...)` to the tools array

### Step 5: Add `get_top_merchants` tool + query function
- Add `GetTopMerchantsInput` interface
- Add `getTopMerchants()` function
- Add `tool('get_top_merchants', ...)` to the tools array

### Step 6: Update system prompt
- Modify `buildFinancialAdvisorPrompt()` in `src/ai/prompts.ts`
- Add 4 bullet points describing new capabilities

### Step 7: Verify
- Run `npx tsc --noEmit` to typecheck
- Run the dev server to verify MCP server loads without errors
- Test each tool via the AI chat

---

## Drizzle ORM Imports

The following additional imports may be needed in `tools.ts`:

```ts
// Already imported: eq, and, gte, lte, like, sql, count, desc
// May need to add: ne, isNull, asc, sum
import { eq, and, gte, lte, like, ne, sql, count, desc, asc } from 'drizzle-orm';
```

The `ne` (not equal) import is needed for filtering `ignored = false`:
```ts
eq(transactions.ignored, false)
```
Actually, since `ignored` is a boolean column with `{ mode: 'boolean' }`, we can use `eq(transactions.ignored, false)` directly with the existing `eq` import.

---

## What This Plan Does NOT Change

- No database schema changes
- No new migrations
- No new API routes
- No frontend changes
- No changes to `agent.ts` or how the agent is invoked
- No new dependencies
- No changes to the dashboard

The new tools are automatically available to the LLM because the agent uses `allowedTools: ['mcp__financial-tools__*']` which wildcards all tools in the `financial-tools` MCP server.
