# Re-categorize Transactions by Date Range — Design

**Date:** 2026-02-27

## Problem

When a new category is added, previously categorized transactions cannot be updated to use it. The existing `/api/ai/categorize` endpoint only targets transactions with a NULL category, so there is no way to re-run AI categorization over existing transactions.

## Solution

Add a "Re-categorize All" section to the Categories page with optional date range filtering (default: all transactions). Overwrites all categories in the selected range.

## Backend

### New function: `recategorize(startDate?, endDate?)` in `src/ai/agent.ts`

Sibling to `batchCategorize`. Differs in one way: no `isNull(transactions.category)` filter. Fetches all transactions in the optional date range and runs them through the same Claude AI categorization call. Returns `{ categorized: number }`.

### New endpoint: `POST /api/ai/recategorize` in `src/api/ai.routes.ts`

Accepts body: `{ startDate?: string, endDate?: string }` (validated with Zod).
Calls `recategorize(startDate, endDate)` and returns the result.
No batch size limit — processes all matching transactions.

## Frontend

### `CategoryManager.vue`

Add a "Re-categorize Transactions" section at the bottom of the page:

- Two optional date inputs: Start Date, End Date (empty = all transactions)
- "Re-categorize All" button — disabled while request is in progress
- Loading indicator while running
- Inline result message: e.g. "247 transactions categorized"
- Inline error message on failure

Calls the new `POST /api/ai/recategorize` endpoint via the existing API client pattern.

## Error Handling

- Button disabled during request to prevent double-submit
- Inline error shown on failure (same pattern as other pages)
- Partial success is fine — returns count of what was successfully categorized

## Out of Scope

- Per-transaction re-categorize button
- Dry-run / preview mode
- Progress streaming for large batches
