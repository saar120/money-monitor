# Manual Scrape Only — Design Spec

**Date:** 2026-04-08
**Status:** Approved

## Problem

Some accounts fail in headless scraping mode and can only be scraped manually via the browser UI. Currently, the scheduled scraper picks up all active accounts indiscriminately, causing repeated failures for these accounts. Users need a way to exclude specific accounts from automated scraping while still being reminded when those accounts become stale.

## Solution

Add a `manualScrapeOnly` flag and a per-account `stalenessDays` threshold to each account. The scheduled scraper skips manual-only accounts. After each scrape session, the post-scrape alert system checks manual-only accounts for staleness and includes reminders in the Telegram alert when any exceed their threshold.

## Data Layer

Two new columns on the `accounts` table:

| Column             | SQLite column        | Type              | Default | Notes                                          |
| ------------------ | -------------------- | ----------------- | ------- | ---------------------------------------------- |
| `manualScrapeOnly` | `manual_scrape_only` | integer (boolean) | `false` | Scheduled scrapes skip this account            |
| `stalenessDays`    | `staleness_days`     | integer           | `null`  | Days before staleness alert. `null` = no alert |

Migration: standard drizzle-kit generated migration adding both columns with defaults.

### Constraints

- `stalenessDays` must be >= 1 when set (enforced in API validation, not DB constraint)
- `manualScrapeOnly` and `isActive` are independent: a manual-only account is still "active" (visible in UI, can be scraped manually). Setting `isActive = false` disables everything including staleness alerts.

## Scheduler Changes

**File:** `src/scraper/session-manager.ts` — `getUniqueActiveAccounts()`

Add a second WHERE clause:

```
WHERE is_active = true AND manual_scrape_only = false
```

This affects three call sites that use `getUniqueActiveAccounts()`:

1. **Cron-triggered scrape** (`scheduler.ts`) — manual-only accounts excluded from daily runs
2. **Missed-scrape catch-up** (`scheduler.ts:checkAndRunMissedScrape`) — same filter
3. **"Scrape All" API endpoint** (`scrape.routes.ts: POST /api/scrape/all`) — also calls `getUniqueActiveAccounts()`, so manual-only accounts are excluded from batch manual scrapes too. This is intentional — if the user wants to scrape a manual-only account, they use the per-account "scrape now" button.

Single-account scrapes via `POST /api/scrape/:id` are unaffected (they fetch the account directly by ID and bypass `getUniqueActiveAccounts()`).

## Post-Scrape Staleness Check

**File:** `src/telegram/alerts.ts` — called from `runPostScrapeAlerts()`

The staleness check runs inside `runPostScrapeAlerts()` (which fires in the `finally` block of `runScrapeSession`, meaning it runs after completed, errored, and cancelled sessions — this is fine, staleness is time-based and should be checked regardless of session outcome).

**Data flow:**

1. Add a new function `getStaleManualAccounts(): StaleAccountInfo[]` in `alerts.ts` (or a shared query module) that:
   - Queries all accounts where `manualScrapeOnly = true` AND `stalenessDays IS NOT NULL` AND `isActive = true`
   - Computes days since `lastScrapedAt` (never-scraped accounts = infinitely stale)
   - Returns only those where elapsed days > `stalenessDays`
2. Call `getStaleManualAccounts()` in `runPostScrapeAlerts()` before building the user message
3. Update `buildPostScrapeUserMessage` signature to accept a third parameter: `staleAccounts: StaleAccountInfo[]`
4. Build the `<stale-manual-accounts>` section from that parameter

Example section in the user message to the alert agent:

```xml
<stale-manual-accounts>
The following accounts are marked "manual scrape only" and have exceeded their staleness threshold:
- "Isracard" (id: 5) — last scraped 12 days ago (threshold: 7 days)
- "Amex" (id: 8) — never scraped (threshold: 7 days)

Remind the user to manually scrape these accounts.
</stale-manual-accounts>
```

If no accounts are stale, this section reads `none`.

### Disabling staleness alerts

- Setting `stalenessDays` to `null` (clearing the input) disables alerts for that specific account
- The user can also disable all post-scrape alerts via the existing `enabled` master switch in AlertSettings

## API Changes

**File:** `src/api/validation.ts` — `updateAccountSchema`

Add to the accepted fields:

- `manualScrapeOnly`: optional boolean
- `stalenessDays`: optional, either a positive integer (min 1) or `null`

**File:** `src/api/accounts.routes.ts` — `PUT /api/accounts/:id`

Include the new fields in the partial update set (same pattern as existing `isActive`, `manualLogin`, `showBrowser`).

**File:** `dashboard/src/api/client.ts` — `updateAccount()` function

The `updateAccount` function defines its own inline `data` parameter type listing accepted fields. Add `manualScrapeOnly` and `stalenessDays` to this type as well, not just the `Account` interface.

## Frontend Changes

### Account Interface

**File:** `dashboard/src/api/client.ts` — `Account` interface

Add:

```ts
manualScrapeOnly: boolean;
stalenessDays: number | null;
```

### Account Card UI

**File:** `dashboard/src/components/AccountManager.vue`

On each account card, add:

1. A **"Manual scrape only"** `Switch` toggle — always visible, follows the same pattern as the existing `manualLogin` toggle
2. When `manualScrapeOnly` is `true`, show a **staleness threshold** row below it with a number `Input` (placeholder: "No alert", min 1). Clearing the input sets `stalenessDays = null`.

Both controls call `patchAccount()` on change, same as existing toggles.

## What stays unchanged

- Single-account manual scrape ("scrape now" button) works for manual-only accounts — no change
- `isActive = false` completely disables an account (no scraping, no staleness alerts, no visibility in scrape selection)
- `manualLogin` flag (show browser for interactive login) is a separate concern and unrelated
- Alert settings (`alert-settings.json`) are not modified — staleness is per-account, not global
- Monthly summary is unaffected

## Migration Order

1. Add the two new columns to `src/db/schema.ts` (in the `accounts` table definition)
2. Run `npm run db:generate` (`drizzle-kit generate`) to produce the migration file
3. Review the generated migration SQL

Never hand-write migration files — per project rules in CLAUDE.md.

## Edge Cases

- **Account toggled to manual-only mid-session:** If a scrape session is already running when the flag is set, the account continues scraping in that session. The flag only affects future session account selection.
- **Never-scraped manual-only account:** `lastScrapedAt` is null, treated as infinitely stale. If `stalenessDays` is set, the alert fires immediately on the next post-scrape check.
- **All accounts are manual-only:** Scheduled scrape runs with zero accounts, session completes immediately, post-scrape alerts still fire (checking staleness).
- **credentialsRef siblings with mixed flags:** If accounts A (manual-only) and B (not manual-only) share the same `credentialsRef`, B is still scraped in scheduled runs and its results populate both A and B (via `resolveAccountForCard`). This is correct — the `lastScrapedAt` on all sibling accounts is updated together (scraper.service.ts updates all accounts with the same `credentialsRef`), so A's staleness timer resets when B is scraped. If the user marks all accounts under a `credentialsRef` as manual-only, none will be picked up by scheduled scrapes.
