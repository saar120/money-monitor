# Ignored Categories & Confidence Score Design

**Date:** 2026-03-04
**Branch:** `ignored_categroies`

## Feature 1: Ignored Categories

### Problem
Users want to exclude entire categories (e.g., "transfer", "income") from statistics and AI analytics responses, without manually ignoring each transaction.

### Design

**Database:** Add `ignored_from_stats INTEGER DEFAULT 0` to `categories` table via Drizzle migration.

**API (`PATCH /api/categories/:id`):** Accept `ignoredFromStats: boolean`. When toggled:
- ON: `UPDATE transactions SET ignored=1 WHERE category=:name`
- OFF: `UPDATE transactions SET ignored=0 WHERE category=:name`
- Wrapped in a DB transaction for atomicity.

**Cascading on new categorization:** `processCategoryResults()` (batch) and `categorize_transaction` tool (interactive) check if the assigned category has `ignoredFromStats=true` and auto-set `transactions.ignored=true`.

**AI Agent prompts:** All prompts that receive categories partition them into active vs ignored:
- Categorizer agents: can still assign ignored categories to transactions
- Analytics agents (spending-analyst, budget-advisor): exclude ignored categories from responses unless user explicitly asks
- Orchestrator: aware of the concept for correct routing

**Dashboard (CategoryManager.vue):** Toggle/switch column per category row. Ignored categories get muted/strikethrough visual styling.

### Affected Files
- `src/db/schema.ts` — add column
- `src/api/categories.routes.ts` — cascade logic
- `src/ai/prompts.ts` — all builder functions
- `src/ai/tools.ts` — `categorize_transaction` tool
- `src/ai/agent.ts` — `processCategoryResults()`
- `dashboard/src/components/CategoryManager.vue` — toggle UI

---

## Feature 2: Confidence Score

### Problem
The batch categorizer uses a boolean `needsReview` flag with no granularity. Users want a numeric confidence level (0-1) so that high-confidence categorizations skip the Insights review queue.

### Design

**Database:** Add `confidence REAL` to `transactions` table via Drizzle migration. Keep `needs_review` and `review_reason` columns (derived from confidence).

**Batch categorizer prompt:** Replace `needsReview: boolean` with `confidence: 0.0-1.0`. LLM output format:
```json
[{"id": 42, "category": "groceries", "confidence": 0.95}]
```

**`processCategoryResults()`:** For each result:
- Store `confidence`
- `needsReview = confidence < 0.8`
- If `confidence < 0.8` and no `reviewReason`: default to "Low confidence categorization"
- If `confidence >= 0.8`: `needsReview=false`, `reviewReason=null`

**Interactive `categorize_transaction` tool:** Add `confidence` as required parameter. Same threshold logic.

**Insights page:** Show confidence as colored indicator (red < 0.5, yellow 0.5-0.8). Allow sorting by confidence for triage.

**AI prompts:** Confidence scale guidance:
- 0.9-1.0: Very clear match
- 0.7-0.8: Likely correct but ambiguous
- 0.5-0.7: Best guess, uncertain
- Below 0.5: Very uncertain, must provide reviewReason

### Affected Files
- `src/db/schema.ts` — add column
- `src/ai/prompts.ts` — batch categorizer prompt
- `src/ai/agent.ts` — `processCategoryResults()` threshold logic
- `src/ai/tools.ts` — `categorize_transaction` tool schema + logic
- `dashboard/src/components/InsightsPage.vue` — confidence display
