# Design: Mark Transactions as Ignored

**Date:** 2026-02-25

## Summary

Allow users to mark individual transactions as ignored via a right-click context menu. Ignored transactions remain visible in the transaction list (dimmed) but are excluded from all statistics.

## Database

Add an `ignored` boolean column to the `transactions` table:

```sql
ALTER TABLE transactions ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0;
```

Implemented via a Drizzle ORM migration. No other schema changes needed.

## Backend

### New endpoint

`PATCH /api/transactions/:id/ignore`

- Accepts `{ ignored: boolean }` in the request body
- Sets the `ignored` flag on the specified transaction
- Returns the updated transaction
- 404 if transaction not found

### Summary route changes

Add `WHERE ignored = 0` to all three aggregation queries in `summary.routes.ts`:
- Group by category
- Group by month
- Group by account

### Transactions route changes

Include the `ignored` field in transaction list responses so the frontend can style rows accordingly.

## Frontend

### TransactionTable.vue

- Rows with `ignored: true` render with dimmed styling (`opacity-40`)
- Right-click on any row opens a context menu positioned at the cursor
- Context menu shows:
  - "Ignore transaction" (if not ignored)
  - "Unignore transaction" (if already ignored)
- On click, calls `PATCH /api/transactions/:id/ignore` and refreshes the table

### Context menu

A Shadcn-based dropdown (or simple `<div>` overlay) anchored to the mouse position on right-click. Dismissed on outside click or Escape.

## Scope

**In scope:**
- Single transaction ignore/unignore via right-click
- Dimmed visual styling for ignored rows
- Excluded from all summary statistics

**Out of scope:**
- Bulk ignore
- Hide/show ignored transactions toggle
- AI categorization changes
