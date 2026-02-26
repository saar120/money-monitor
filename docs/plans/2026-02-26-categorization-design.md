# Categorization Improvements Design

**Date:** 2026-02-26
**Status:** Approved

## Goals

1. Category management UI — add, edit, delete categories stored in DB
2. Auto-categorize on import — send new transactions to Claude after scraping
3. Manual categorization — inline dropdown in the transaction table

---

## Database Schema

### New `categories` table

```sql
categories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL UNIQUE,   -- slug used in transactions.category (e.g. "food")
  label     TEXT NOT NULL,          -- display name (e.g. "Food")
  color     TEXT,                   -- hex color for badges (e.g. "#22c55e")
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
)
```

- Seeded with the existing 12 categories from `CATEGORIES` in `src/ai/prompts.ts`
- `transactions.category` stays as a plain `TEXT` field (no FK) so deleted categories don't break existing data
- Migration added via Drizzle

---

## Backend

### New endpoints: `/api/categories`

| Method   | Path                   | Description                   |
|----------|------------------------|-------------------------------|
| `GET`    | `/api/categories`      | List all categories           |
| `POST`   | `/api/categories`      | Create a new category         |
| `PATCH`  | `/api/categories/:id`  | Update name / label / color   |
| `DELETE` | `/api/categories/:id`  | Delete a category             |

### Modified: `PATCH /api/transactions/:id`

Add `category` to the set of updatable fields. Used by the inline dropdown.

### Modified: Scrape flow

After new transactions are saved to DB, call `batchCategorize()` on the newly inserted transaction IDs only (those without a category). This happens automatically after every scrape — no UI trigger needed.

### Modified: AI prompt & tools

- `CATEGORIES` constant in `src/ai/prompts.ts` becomes a DB query at runtime
- The system prompt injects the current category list dynamically
- The `categorize_transaction` tool's enum also uses the dynamic list

---

## Frontend

### 3a. Category Manager page

- New top-level page/tab (e.g. "Categories")
- Table showing: color swatch | name | label | actions (edit, delete)
- Inline editing of name, label, color picker
- "Add category" button opens a small form row
- Delete shows a confirmation; warns if the category is currently in use by transactions

### 3b. Inline category dropdown in TransactionTable

- Category column cell is clickable (shows current category badge or "—")
- Clicking opens a `<Select>` dropdown populated from `GET /api/categories`
- Includes a "None" option to clear the category
- On selection: calls `PATCH /api/transactions/:id` with `{ category: selectedName }`
- Optimistic update — reverts on error

### 3c. Auto-categorize on import (silent, best-effort)

- Triggered automatically after each scrape completes
- Only uncategorized new transactions are sent to Claude
- Previously categorized transactions are never overwritten
- Toast notification: e.g. "Categorized 8 of 10 new transactions"

---

## Data Flow

```
Scrape completes
  → new transactions saved to DB (category = NULL)
  → batchCategorize(newTxnIds) called
      → fetches categories from DB → builds prompt
      → Claude returns [{id, category}]
      → validates category names against DB
      → updates transactions
  → toast shown in UI
```

```
User clicks category cell in table
  → dropdown opens with categories from DB
  → user selects category
  → PATCH /api/transactions/:id { category }
  → cell updates optimistically
```

```
User opens Categories page
  → GET /api/categories
  → table renders with edit/delete controls
  → changes via POST/PATCH/DELETE /api/categories
  → AI prompt picks up changes on next request (no restart needed)
```

---

## Out of Scope

- Category ordering / drag-to-reorder
- Per-category spending limits or budgets
- Bulk re-categorize from the UI (use AI chat for this)
- Category icons (color only for now)
