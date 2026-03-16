# Latest Scrape Transactions — Design Spec

## Problem

When the Telegram bot sends a post-scrape alert, the user may reply asking "what was scraped?" or "show me the new transactions." The chat agent has no way to answer — it only has general query tools (filter by date, category, etc.) and cannot distinguish transactions that were newly inserted during a specific scrape session from ones that already existed. The `newIds[]` array computed during scraping is discarded after the session ends.

## Solution

Link each newly-scraped transaction to its scrape session via a FK column, and expose a tool that retrieves the latest scrape's new transactions.

## Design

### 1. Schema: Add `scrapeSessionId` to `transactions`

Add a nullable integer column `scrape_session_id` to the `transactions` table, referencing `scrape_sessions.id`.

- **Nullable** because existing transactions predate this feature and manual/imported transactions have no scrape session.
- Populated at insert time during `scrapeAccount()` when a `sessionId` is provided.
- **Add an index** on `scrape_session_id` (following the existing pattern of indexing FK columns that are queried — see `idx_transactions_account_id` etc.).

**Migration:** Generated via `drizzle-kit generate` (per project convention — never hand-write migrations).

### 2. Scraper change: Populate `scrapeSessionId` on insert

In `src/scraper/scraper.service.ts`, the `mapTransaction()` helper and the insert statement need to include `scrapeSessionId: sessionId` when inserting new transactions. The `sessionId` parameter already flows into `scrapeAccount()` from the session manager.

Specifically:

- `NewTransaction` is `InferInsertModel<typeof transactions>` — it auto-infers from the Drizzle schema, so adding the column to `schema.ts` is sufficient. **No manual change to `types.ts` is needed.**
- Set `scrapeSessionId` at the insert callsite (spreading `{ ...mapped, scrapeSessionId: sessionId ?? null }`) rather than threading it through `mapTransaction()`, since the session ID is a session-level concern.

### 3. New tool: `get_latest_scrape_transactions`

A zero-parameter read-only tool for the chat agent.

**Implementation (in `src/ai/tools.ts`):**

1. Query `scrapeSessions` for the latest completed session: `SELECT * FROM scrape_sessions WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1`
2. Query transactions where `scrape_session_id = <that session ID>`, joined with `accounts` to get `displayName`. Cap at 200 transactions; if more exist, include a `"truncated": true` flag and the total count.
3. Also pull the associated `scrapeLogs` for that session to include per-account stats (found/new counts, errors)
4. Return a `JSON.stringify(result)` string (matching existing tool conventions):

```json
{
  "session": {
    "id": 42,
    "trigger": "scheduled",
    "startedAt": "2026-03-16T08:00:00Z",
    "completedAt": "2026-03-16T08:02:30Z"
  },
  "accounts": [
    { "accountId": 1, "displayName": "Visa 4521", "transactionsFound": 45, "transactionsNew": 3 }
  ],
  "newTransactions": [
    {
      "id": 101,
      "date": "2026-03-15",
      "chargedAmount": -250,
      "description": "Shufersal",
      "category": "groceries",
      "accountName": "Visa 4521"
    }
  ],
  "totalNew": 3
}
```

If no completed session exists, return `{ "error": "No completed scrape sessions found" }`.

### 4. Register the tool

- **Chat agent** (`src/ai/agent.ts`): Add `buildGetLatestScrapeTransactionsTool()` to the `tools` array in `chat()`.
- **Alert agent** (`src/ai/alert-agent.ts`): Add to `buildAlertTools()` — the alert agent can also use it to look up exactly what was new.
- **Tool status map** (`src/ai/agent.ts`): Add entry `'get_latest_scrape_transactions': 'Looking up latest scrape results...'`.

### 5. Prompt hint

Add to the financial advisor system prompt (`buildFinancialAdvisorPrompt` in `src/ai/prompts.ts`):

> When the user asks what was scraped, what's new, or what transactions were found in the latest scrape, use the `get_latest_scrape_transactions` tool.

This goes in the spending analysis section since it's most closely related.

## Files to modify

| File                             | Change                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `src/db/schema.ts`               | Add `scrapeSessionId` column + index to `transactions`                           |
| `src/scraper/scraper.service.ts` | Populate `scrapeSessionId` during insert                                         |
| `src/ai/tools.ts`                | Add `buildGetLatestScrapeTransactionsTool()` and `getLatestScrapeTransactions()` |
| `src/ai/agent.ts`                | Register tool in chat agent + tool status map                                    |
| `src/ai/alert-agent.ts`          | Register tool in alert agent                                                     |
| `src/ai/prompts.ts`              | Add prompt hint about the tool                                                   |

## Scope boundaries

- **Latest only:** The tool returns the single most recent completed scrape session. No history browsing.
- **No UI changes:** This is a Telegram bot / AI tool change only. The dashboard is unaffected.
- **No alert behavior change:** The post-scrape alert continues to work as before — selective and smart. This tool gives the user a way to ask for the full list on demand.

## Testing

- Verify the migration generates correctly via `npm run db:generate`
- Scrape an account and confirm `scrape_session_id` is set on new transactions
- Ask the bot "what was scraped?" and verify it uses the tool and returns accurate results
- Verify the tool returns a clear message when no completed scrape sessions exist
- Verify the tool handles a session where all transactions were duplicates (zero new) — should return session info with `totalNew: 0` and empty `newTransactions`
- Verify multi-account sessions show per-account breakdowns correctly, including any failed accounts from `scrapeLogs`
